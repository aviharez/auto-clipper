// ── Compose Editor ────────────────────────────────────────────────────────────

let _compEditorId = null;
let _compEditorPoll = null;
const _segPatchTimers = {};

async function showComposeEditor(compId) {
  clearTimeout(_composePoll);
  clearTimeout(_listPoll);
  clearTimeout(_detailPoll);
  clearTimeout(_compEditorPoll);
  _compEditorId = compId;
  setSidebarNav('compose');

  app.innerHTML = `<div class="loading">Loading composition…</div>`;

  let comp;
  try {
    comp = await api('GET', '/compositions/' + compId);
  } catch (e) {
    app.innerHTML = `<div class="empty">Composition not found.</div>`;
    return;
  }

  app.innerHTML = `
    <div class="compose-editor">
      <div class="compose-editor-header">
        <a class="breadcrumb-back" href="#compose" onclick="location.hash='compose';return false;">← Compose</a>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-title" id="ce-title">${escAttr(comp.title)}</span>
        <div style="flex:1"></div>
        ${badge(comp.status)}
      </div>
      <div class="compose-editor-body">
        <div class="compose-editor-shell">
          <div class="compose-col compose-col-left" id="ce-left">
            <div class="ce-col-header">
              <span class="compose-col-label" style="margin-bottom:0">Segments</span>
              <span class="ce-seg-count" id="ce-seg-count"></span>
            </div>
            <div class="ce-segments-list" id="ce-segments-list"></div>
            <div class="ce-add-segment" id="ce-add-segment">
              <div class="ce-add-kind-row">
                <button class="ce-kind-pill active" data-kind="yt">YT</button>
                <button class="ce-kind-pill" data-kind="local">Local</button>
                <button class="ce-kind-pill" data-kind="image">Image</button>
              </div>
              <div class="ce-add-url-row" id="ce-add-url-row">
                <input class="form-input ce-url-input" id="ce-url-input" type="url"
                       placeholder="https://youtube.com/watch?v=…" />
                <button class="btn btn-primary btn-sm" id="ce-fetch-btn">Fetch</button>
              </div>
              <div class="ce-add-file-row" id="ce-add-file-row" style="display:none">
                <label class="btn btn-ghost btn-sm ce-file-label">
                  Choose file…
                  <input type="file" id="ce-file-input" style="display:none" />
                </label>
                <span class="ce-file-name" id="ce-file-name"></span>
                <button class="btn btn-primary btn-sm" id="ce-upload-btn" disabled>Upload</button>
              </div>
            </div>
          </div>
          <div class="compose-col compose-col-center" id="ce-center">
            <div class="compose-preview-placeholder" id="ce-preview-placeholder">
              <div style="font-size:28px;margin-bottom:8px">▶</div>
              <div>Render preview to see your video</div>
              <div style="font-size:11px;margin-top:6px;color:var(--text-dim)">Add a segment, then click Render</div>
            </div>
          </div>
          <div class="compose-col compose-col-right" id="ce-right">
            <div id="ce-right-panels"></div>
          </div>
        </div>
        <div class="compose-timeline-placeholder">Timeline (Phase D)</div>
      </div>
    </div>
  `;

  await loadPresets();
  renderCESegments(comp.segments || []);
  renderCERightRail(comp);
  setupCEAddSegment(compId);

  // 3.5b: start polling if any segment is downloading
  if ((comp.segments || []).some(s => s.status === 'downloading')) {
    _startSegIngestPoll(compId);
  }
}

// 3.5b: Poll every 1.5s while any segment is downloading; auto-fill trim_out on ready
function _startSegIngestPoll(compId) {
  clearTimeout(_compEditorPoll);
  _compEditorPoll = setTimeout(async () => {
    if (_compEditorId !== compId) return;
    try {
      const comp = await api('GET', '/compositions/' + compId);
      renderCESegments(comp.segments || []);
      // Auto-fill trim_out for segments that just became ready
      for (const seg of comp.segments || []) {
        if (seg.status === 'ready' && seg.source_duration != null && seg.trim_out == null) {
          try {
            await api('PATCH', '/segments/' + seg.id, { trim_out: seg.source_duration });
          } catch (_) {}
        }
      }
      if ((comp.segments || []).some(s => s.status === 'downloading')) {
        _startSegIngestPoll(compId);
      }
    } catch (_) {}
  }, 1500);
}

function renderCESegments(segments) {
  const list = document.getElementById('ce-segments-list');
  const countEl = document.getElementById('ce-seg-count');
  if (!list) return;
  if (countEl) countEl.textContent = segments.length ? `${segments.length} seg${segments.length !== 1 ? 's' : ''}` : '';
  if (!segments.length) {
    list.innerHTML = '<div class="ce-segs-empty">No segments yet.</div>';
    return;
  }
  list.innerHTML = segments.map(s => renderCESegmentRow(s)).join('');
  attachCESegmentHandlers(segments);
}

const KIND_COLORS = { yt: '#3b82f6', local: '#a855f7', image: '#0891b2' };
const KIND_LABELS = { yt: 'YT', local: 'Local', image: 'Img' };

function renderCESegmentRow(seg) {
  const color = KIND_COLORS[seg.kind] || '#888';
  const kindLabel = KIND_LABELS[seg.kind] || seg.kind;
  const label = seg.label || (seg.source_url ? seg.source_url.slice(0, 28) + '…' : '(no label)');
  const dur = seg.duration != null ? fmtDuration(seg.duration) : '–';

  // 3.5b: progress strip for downloading segments, error line for failed
  let statusExtra = '';
  if (seg.status === 'downloading') {
    const pct = seg.download_progress != null ? Math.min(seg.download_progress, 100) : 0;
    statusExtra = `
      <div class="ce-seg-dl-bar">
        <div class="ce-seg-dl-fill" style="width:${pct}%"></div>
      </div>`;
  } else if (seg.status === 'failed' && seg.error) {
    statusExtra = `<div class="ce-seg-error">${escAttr(seg.error.split('\n')[0])}</div>`;
  }

  return `
    <div class="ce-seg-row" data-seg-id="${seg.id}" data-expanded="false">
      <div class="ce-seg-collapsed" onclick="_ceToggleSeg('${seg.id}')">
        <span class="ce-seg-drag">⠿</span>
        <span class="ce-kind-badge" style="background:${color}">${kindLabel}</span>
        <div class="ce-seg-thumb"></div>
        <div class="ce-seg-info">
          <div class="ce-seg-label">${escAttr(label)}</div>
          <div class="ce-seg-dur">${dur}</div>
        </div>
        ${badge(seg.status)}
        <button class="ce-seg-trash btn btn-ghost btn-sm" data-seg-trash="${seg.id}" title="Delete segment">✕</button>
        <span class="ce-seg-expand-arrow" id="ce-arrow-${seg.id}">›</span>
      </div>
      ${statusExtra}
      <div class="ce-seg-expanded" id="ce-seg-exp-${seg.id}" style="display:none">
        ${renderCESegmentExpanded(seg)}
      </div>
    </div>`;
}

function renderCESegmentExpanded(seg) {
  if (seg.kind === 'image') {
    const motions = [
      { id: 'static',   label: 'Static' },
      { id: 'slide_lr', label: 'Slide L→R' },
      { id: 'slide_rl', label: 'Slide R→L' },
      { id: 'zoom_in',  label: 'Zoom In' },
      { id: 'zoom_out', label: 'Zoom Out' },
    ];
    return `
      <div class="ce-seg-fields">
        <label class="form-label">Motion</label>
        <div class="ce-motion-grid">
          ${motions.map(m => `
            <button class="ce-motion-btn${seg.motion === m.id ? ' active' : ''}"
                    data-seg-motion="${seg.id}" data-motion="${m.id}">${m.label}</button>
          `).join('')}
        </div>
        <label class="form-label" style="margin-top:8px">Duration (s)</label>
        <div class="ce-nudge-row">
          <input class="form-input ce-dur-input" type="number" step="0.5" min="0.5"
                 id="ce-dur-${seg.id}" value="${seg.duration != null ? seg.duration : 3}" />
          <button class="btn btn-ghost btn-sm" data-seg-dur-delta="${seg.id}" data-delta="-0.5">−0.5</button>
          <button class="btn btn-ghost btn-sm" data-seg-dur-delta="${seg.id}" data-delta="0.5">+0.5</button>
        </div>
        ${renderCETransitionFields(seg)}
      </div>`;
  }

  // 3.5b: show source_duration hint next to trim_out when trim_out is unset
  const srcDurHint = (seg.duration == null && seg.source_duration != null)
    ? `<span style="font-size:10px;color:var(--text-dim);margin-left:4px">full: ${seg.source_duration.toFixed(1)}s</span>`
    : '';

  return `
    <div class="ce-seg-fields">
      <label class="form-label">Label</label>
      <input class="form-input" type="text" id="ce-lbl-${seg.id}"
             value="${escAttr(seg.label || '')}" placeholder="Optional label"
             oninput="_cePatchSegDebounced('${seg.id}', {label: this.value})" />
      <label class="form-label" style="margin-top:8px">Trim In (s)</label>
      <div class="ce-nudge-row">
        <input class="form-input ce-dur-input" type="number" step="0.5" min="0"
               id="ce-trimin-${seg.id}" value="${seg.trim_in != null ? seg.trim_in : 0}" />
        <button class="btn btn-ghost btn-sm" data-seg-trim-delta="${seg.id}" data-field="trim_in" data-delta="-0.5">−0.5</button>
        <button class="btn btn-ghost btn-sm" data-seg-trim-delta="${seg.id}" data-field="trim_in" data-delta="0.5">+0.5</button>
      </div>
      <label class="form-label" style="margin-top:8px">Trim Out (s)${srcDurHint}</label>
      <div class="ce-nudge-row">
        <input class="form-input ce-dur-input" type="number" step="0.5" min="0"
               id="ce-trimout-${seg.id}" value="${seg.trim_out != null ? seg.trim_out : ''}" placeholder="end" />
        <button class="btn btn-ghost btn-sm" data-seg-trim-delta="${seg.id}" data-field="trim_out" data-delta="-0.5">−0.5</button>
        <button class="btn btn-ghost btn-sm" data-seg-trim-delta="${seg.id}" data-field="trim_out" data-delta="0.5">+0.5</button>
      </div>
      ${renderCETransitionFields(seg)}
    </div>`;
}

function renderCETransitionFields(seg) {
  return `
    <label class="form-label" style="margin-top:8px">Transition to next</label>
    <select class="form-input" id="ce-trans-${seg.id}"
            onchange="_cePatchSeg('${seg.id}', {transition_to_next: this.value})">
      <option value="cut"${seg.transition_to_next === 'cut' ? ' selected' : ''}>Cut</option>
      <option value="fade"${seg.transition_to_next === 'fade' ? ' selected' : ''}>Fade</option>
      <option value="slide_up"${seg.transition_to_next === 'slide_up' ? ' selected' : ''}>Slide Up</option>
    </select>`;
}

function attachCESegmentHandlers(segments) {
  // trash buttons
  document.querySelectorAll('[data-seg-trash]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const segId = btn.dataset.segTrash;
      try {
        await api('DELETE', '/segments/' + segId);
        const comp = await api('GET', '/compositions/' + _compEditorId);
        renderCESegments(comp.segments || []);
      } catch (ex) { toast('Error: ' + ex.message, 'error'); }
    };
  });

  // motion buttons
  document.querySelectorAll('[data-seg-motion]').forEach(btn => {
    btn.onclick = () => {
      const segId = btn.dataset.segMotion;
      document.querySelectorAll(`[data-seg-motion="${segId}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _cePatchSeg(segId, { motion: btn.dataset.motion });
    };
  });

  // duration nudge
  document.querySelectorAll('[data-seg-dur-delta]').forEach(btn => {
    btn.onclick = () => {
      const segId = btn.dataset.segDurDelta;
      const inp = document.getElementById('ce-dur-' + segId);
      if (!inp) return;
      const v = (parseFloat(inp.value) || 0) + parseFloat(btn.dataset.delta);
      inp.value = Math.max(0.5, v).toFixed(1);
      _cePatchSegDebounced(segId, { duration: parseFloat(inp.value) });
    };
  });
  document.querySelectorAll('.ce-dur-input').forEach(inp => {
    if (inp.id.startsWith('ce-dur-')) {
      const segId = inp.id.slice('ce-dur-'.length);
      inp.oninput = () => _cePatchSegDebounced(segId, { duration: parseFloat(inp.value) || null });
    }
  });

  // trim nudge
  document.querySelectorAll('[data-seg-trim-delta]').forEach(btn => {
    btn.onclick = () => {
      const segId = btn.dataset.segTrimDelta;
      const field = btn.dataset.field;
      const inp = document.getElementById(field === 'trim_in' ? `ce-trimin-${segId}` : `ce-trimout-${segId}`);
      if (!inp) return;
      const v = (parseFloat(inp.value) || 0) + parseFloat(btn.dataset.delta);
      inp.value = Math.max(0, v).toFixed(1);
      _cePatchSegDebounced(segId, { [field]: parseFloat(inp.value) });
    };
  });
  document.querySelectorAll('[id^="ce-trimin-"], [id^="ce-trimout-"]').forEach(inp => {
    const isIn = inp.id.startsWith('ce-trimin-');
    const segId = inp.id.slice(isIn ? 'ce-trimin-'.length : 'ce-trimout-'.length);
    inp.oninput = () => _cePatchSegDebounced(segId, { [isIn ? 'trim_in' : 'trim_out']: parseFloat(inp.value) || null });
  });
}

function _ceToggleSeg(segId) {
  const row = document.querySelector(`[data-seg-id="${segId}"]`);
  if (!row) return;
  const expanded = row.dataset.expanded === 'true';
  row.dataset.expanded = !expanded;
  const expDiv = document.getElementById('ce-seg-exp-' + segId);
  const arrow = document.getElementById('ce-arrow-' + segId);
  if (expDiv) expDiv.style.display = expanded ? 'none' : '';
  if (arrow) arrow.style.transform = expanded ? '' : 'rotate(90deg)';
}

async function _cePatchSeg(segId, fields) {
  try {
    await api('PATCH', '/segments/' + segId, fields);
  } catch (e) { toast('Save error: ' + e.message, 'error'); }
}

function _cePatchSegDebounced(segId, fields) {
  clearTimeout(_segPatchTimers[segId]);
  _segPatchTimers[segId] = setTimeout(() => _cePatchSeg(segId, fields), 500);
}

function setupCEAddSegment(compId) {
  let currentKind = 'yt';

  document.querySelectorAll('.ce-kind-pill').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.ce-kind-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentKind = btn.dataset.kind;
      const urlRow = document.getElementById('ce-add-url-row');
      const fileRow = document.getElementById('ce-add-file-row');
      const urlInput = document.getElementById('ce-url-input');
      if (currentKind === 'local' || currentKind === 'image') {
        urlRow.style.display = 'none';
        fileRow.style.display = '';
        const fileInput = document.getElementById('ce-file-input');
        if (fileInput) {
          fileInput.accept = currentKind === 'image' ? 'image/*' : 'video/*';
        }
      } else {
        urlRow.style.display = '';
        fileRow.style.display = 'none';
        if (urlInput) urlInput.placeholder = 'https://youtube.com/watch?v=…';
      }
    };
  });

  const fetchBtn = document.getElementById('ce-fetch-btn');
  if (fetchBtn) {
    fetchBtn.onclick = async () => {
      const urlInput = document.getElementById('ce-url-input');
      const url = urlInput?.value?.trim();
      if (!url) { toast('Enter a URL first', 'error'); return; }
      fetchBtn.disabled = true;
      fetchBtn.textContent = '…';
      try {
        await api('POST', '/compositions/' + compId + '/segments', { kind: currentKind, source_url: url });
        urlInput.value = '';
        const comp = await api('GET', '/compositions/' + compId);
        renderCESegments(comp.segments || []);
        toast('Segment added — downloading…');
        // 3.5b: start polling since YT segment is now downloading
        _startSegIngestPoll(compId);
      } catch (e) {
        toast('Error: ' + e.message, 'error');
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch';
      }
    };
  }

  const fileInput = document.getElementById('ce-file-input');
  const fileNameEl = document.getElementById('ce-file-name');
  const uploadBtn = document.getElementById('ce-upload-btn');
  if (fileInput) {
    fileInput.onchange = () => {
      const f = fileInput.files[0];
      if (f) {
        if (fileNameEl) fileNameEl.textContent = f.name;
        if (uploadBtn) uploadBtn.disabled = false;
      }
    };
  }
  if (uploadBtn) {
    uploadBtn.onclick = async () => {
      const f = fileInput?.files[0];
      if (!f) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = '…';
      try {
        const fd = new FormData();
        fd.append('kind', currentKind);
        fd.append('file', f);
        const res = await fetch('/api/compositions/' + compId + '/segments/upload', { method: 'POST', body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || res.statusText);
        }
        if (fileInput) fileInput.value = '';
        if (fileNameEl) fileNameEl.textContent = '';
        const comp = await api('GET', '/compositions/' + compId);
        renderCESegments(comp.segments || []);
        toast('Segment uploaded');
        // 3.5b: poll briefly so source_duration fills in
        _startSegIngestPoll(compId);
      } catch (e) {
        toast('Error: ' + e.message, 'error');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload';
      }
    };
  }
}

// ── Compose right rail ─────────────────────────────────────────────────────────

function renderCERightRail(comp) {
  const container = document.getElementById('ce-right-panels');
  if (!container) return;

  const panels = [
    { id: 'output',   title: 'Output length',  open: true,  fn: () => renderCEPanelOutput(comp) },
    { id: 'hook',     title: 'Hook',            open: false, fn: () => renderCEPanelHook(comp) },
    { id: 'voiceover',title: 'Voiceover',       open: false, fn: () => renderCEPanelVoiceover(comp) },
    { id: 'captions', title: 'Captions',        open: false, fn: () => renderCEPanelCaptions(comp) },
    { id: 'music',    title: 'Bed music',        open: false, fn: () => renderCEPanelMusic(comp) },
    { id: 'sfx',      title: 'Spot SFX',        open: false, fn: () => renderCEPanelSFX(comp) },
  ];

  container.innerHTML = panels.map(p => `
    <div class="ce-panel" id="ce-panel-${p.id}">
      <button class="ce-panel-header" onclick="_cePanelToggle('${p.id}')">
        <span class="ce-panel-title">${p.title}</span>
        <span class="ce-panel-arrow" id="ce-panel-arrow-${p.id}">${p.open ? '▾' : '›'}</span>
      </button>
      <div class="ce-panel-body" id="ce-panel-body-${p.id}" style="${p.open ? '' : 'display:none'}">
        ${p.fn()}
      </div>
    </div>
  `).join('');

  attachCERightRailHandlers(comp);
}

function _cePanelToggle(panelId) {
  const body = document.getElementById('ce-panel-body-' + panelId);
  const arrow = document.getElementById('ce-panel-arrow-' + panelId);
  if (!body) return;
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '▾' : '›';
}

function renderCEPanelOutput(comp) {
  return `
    <div class="ce-field-group">
      <label class="form-label">Target duration (seconds)</label>
      <div class="ce-nudge-row">
        <input class="form-input" type="number" id="ce-target-sec" min="5" max="90"
               value="${comp.target_sec || 38}" />
        <input type="range" id="ce-target-range" min="5" max="90" step="1"
               value="${comp.target_sec || 38}" style="flex:1;accent-color:var(--accent)" />
      </div>
      <div class="form-label" style="margin-top:4px;color:var(--text-muted)" id="ce-seg-dur-sum">
        Current segments: – s
      </div>
    </div>`;
}

function renderCEPanelHook(comp) {
  const anims = ['none', 'slide_in_top', 'fade_in', 'pop'];
  return `
    <div class="ce-field-group">
      <label class="form-label">Hook text</label>
      <textarea class="form-input ce-textarea" id="ce-hook-text" rows="2"
                placeholder="Use [word] for highlights…">${escAttr(comp.hook_text || '')}</textarea>
      <label class="form-label" style="margin-top:8px">Animation</label>
      <select class="form-input" id="ce-hook-anim">
        ${anims.map(a => `<option value="${a}"${comp.hook_animation === a ? ' selected' : ''}>${a}</option>`).join('')}
      </select>
    </div>`;
}

function renderCEPanelVoiceover(comp) {
  const voices = [
    { id: 'af_bella',   label: 'Bella (F)' },
    { id: 'af_nicole',  label: 'Nicole (F)' },
    { id: 'am_michael', label: 'Michael (M)' },
    { id: 'am_adam',    label: 'Adam (M)' },
  ];
  return `
    <div class="ce-field-group">
      <label class="form-label">Upload WAV / MP3</label>
      <label class="btn btn-ghost btn-sm ce-file-label" style="width:100%;justify-content:center">
        Choose file…
        <input type="file" id="ce-vo-file" accept=".wav,.mp3,.m4a" style="display:none"
               onchange="document.getElementById('ce-vo-fname').textContent=this.files[0]?.name||''" />
      </label>
      <span class="ce-file-name" id="ce-vo-fname" style="margin-top:4px"></span>
      <button class="btn btn-primary btn-sm" id="ce-vo-upload-btn" style="margin-top:6px;width:100%;justify-content:center">
        Upload
      </button>
      <div class="ce-divider">— or generate —</div>
      <label class="form-label">Kokoro voice</label>
      <select class="form-input" id="ce-kokoro-voice">
        ${voices.map(v => `<option value="${v.id}"${comp.voiceover_kokoro_voice === v.id ? ' selected' : ''}>${v.label}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" id="ce-kokoro-btn" style="margin-top:6px;width:100%;justify-content:center">
        Generate voiceover
      </button>
      <div class="form-label" style="margin-top:6px;color:var(--text-muted)" id="ce-vo-status">
        ${comp.voiceover_source ? 'Source: ' + comp.voiceover_source : 'No voiceover yet'}
      </div>
    </div>`;
}

function renderCEPanelCaptions(comp) {
  const cp = _presets?.caption || {};
  const modes = ['script', 'transcribe', 'srt'];
  return `
    <div class="ce-field-group">
      <label class="form-label">Caption text / script</label>
      <textarea class="form-input ce-textarea" id="ce-captions-text" rows="4"
                placeholder="Type your script here…">${escAttr(comp.captions_text || '')}</textarea>
      <label class="form-label" style="margin-top:8px">Mode</label>
      <div class="ce-mode-toggle">
        ${modes.map(m => `<button class="ce-mode-btn${comp.captions_mode === m ? ' active' : ''}"
               data-captions-mode="${m}">${m}</button>`).join('')}
      </div>
      <label class="form-label" style="margin-top:8px">Caption style</label>
      <select class="form-input" id="ce-caption-preset">
        <option value="">None</option>
        ${Object.keys(cp).map(k => `<option value="${k}"${comp.caption_preset === k ? ' selected' : ''}>${k.replace(/_/g,' ')}</option>`).join('')}
      </select>
    </div>`;
}

function renderCEPanelMusic(comp) {
  return `
    <div class="ce-field-group">
      <label class="form-label">Bed music track</label>
      <select class="form-input" id="ce-bed-music">
        <option value="">None</option>
      </select>
      <label class="form-label" style="margin-top:8px">Gain (dB): <span id="ce-bed-gain-val">${comp.bed_music_gain_db != null ? comp.bed_music_gain_db : -14}</span></label>
      <input type="range" id="ce-bed-gain" min="-30" max="0" step="1"
             value="${comp.bed_music_gain_db != null ? comp.bed_music_gain_db : -14}"
             style="width:100%;accent-color:var(--accent)" />
      <label class="form-checkbox-row" style="margin-top:8px">
        <input type="checkbox" id="ce-bed-duck" ${comp.bed_music_duck ? 'checked' : ''} />
        <span>Duck under voice</span>
      </label>
    </div>`;
}

function renderCEPanelSFX(comp) {
  const sfxRows = (comp.sfx || []).map(s => `
    <div class="ce-sfx-row" data-sfx-id="${s.id}">
      <input class="form-input" type="number" step="0.1" min="0" value="${s.at_sec}"
             style="width:64px" onchange="_cePatchSFX('${s.id}', {at_sec: parseFloat(this.value)})" />
      <select class="form-input" style="flex:1" onchange="_cePatchSFX('${s.id}', {file: this.value})">
        <option value="${s.file}">${s.file}</option>
      </select>
      <input class="form-input" type="number" step="1" value="${s.gain_db}" style="width:52px"
             onchange="_cePatchSFX('${s.id}', {gain_db: parseFloat(this.value)})" />
      <button class="btn btn-ghost btn-sm" onclick="_ceDeleteSFX('${s.id}')">✕</button>
    </div>`).join('');
  return `
    <div class="ce-field-group">
      <div class="ce-sfx-header"><span class="form-label" style="margin:0">at(s)</span><span class="form-label" style="margin:0;flex:1">file</span><span class="form-label" style="margin:0">dB</span></div>
      <div id="ce-sfx-list">${sfxRows || '<div style="color:var(--text-dim);font-size:12px;padding:4px 0">No SFX drops yet</div>'}</div>
      <button class="btn btn-ghost btn-sm" id="ce-add-sfx-btn" style="margin-top:6px">+ Add SFX</button>
    </div>`;
}

async function _cePatchSFX(sfxId, fields) {
  try { await api('PATCH', '/sfx/' + sfxId, fields); } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function _ceDeleteSFX(sfxId) {
  try {
    await api('DELETE', '/sfx/' + sfxId);
    const comp = await api('GET', '/compositions/' + _compEditorId);
    renderCERightRail(comp);
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

function _cePatchComp(fields) {
  if (!_compEditorId) return;
  api('PATCH', '/compositions/' + _compEditorId, fields).catch(e => toast('Save error: ' + e.message, 'error'));
}

function attachCERightRailHandlers(comp) {
  // Output length
  const targetSec = document.getElementById('ce-target-sec');
  const targetRange = document.getElementById('ce-target-range');
  if (targetSec && targetRange) {
    const syncTargetSec = () => {
      targetRange.value = targetSec.value;
      _cePatchComp({ target_sec: parseFloat(targetSec.value) });
    };
    const syncTargetRange = () => {
      targetSec.value = targetRange.value;
      _cePatchComp({ target_sec: parseFloat(targetRange.value) });
    };
    targetSec.onchange = syncTargetSec;
    targetRange.oninput = syncTargetRange;
  }

  // Hook
  const hookText = document.getElementById('ce-hook-text');
  if (hookText) hookText.oninput = () => _cePatchComp({ hook_text: hookText.value });
  const hookAnim = document.getElementById('ce-hook-anim');
  if (hookAnim) hookAnim.onchange = () => _cePatchComp({ hook_animation: hookAnim.value });

  // Voiceover stubs
  const voUploadBtn = document.getElementById('ce-vo-upload-btn');
  if (voUploadBtn) {
    voUploadBtn.onclick = () => toast('Voiceover upload coming in Step 3.14', '');
  }
  const kokoroBtn = document.getElementById('ce-kokoro-btn');
  if (kokoroBtn) {
    kokoroBtn.onclick = async () => {
      const voice = document.getElementById('ce-kokoro-voice')?.value;
      _cePatchComp({ voiceover_kokoro_voice: voice });
      toast('Kokoro TTS coming in Step 3.13', '');
    };
  }
  const kokoroVoice = document.getElementById('ce-kokoro-voice');
  if (kokoroVoice) kokoroVoice.onchange = () => _cePatchComp({ voiceover_kokoro_voice: kokoroVoice.value });

  // Captions
  const captText = document.getElementById('ce-captions-text');
  if (captText) captText.oninput = () => _cePatchComp({ captions_text: captText.value });
  document.querySelectorAll('[data-captions-mode]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-captions-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _cePatchComp({ captions_mode: btn.dataset.captionsMode });
    };
  });
  const captPreset = document.getElementById('ce-caption-preset');
  if (captPreset) captPreset.onchange = () => _cePatchComp({ caption_preset: captPreset.value });

  // Music
  const bedGain = document.getElementById('ce-bed-gain');
  const bedGainVal = document.getElementById('ce-bed-gain-val');
  if (bedGain) {
    bedGain.oninput = () => {
      if (bedGainVal) bedGainVal.textContent = bedGain.value;
      _cePatchComp({ bed_music_gain_db: parseFloat(bedGain.value) });
    };
  }
  const bedDuck = document.getElementById('ce-bed-duck');
  if (bedDuck) bedDuck.onchange = () => _cePatchComp({ bed_music_duck: bedDuck.checked ? 1 : 0 });

  // Load music library async
  api('GET', '/music-library').then(items => {
    const sel = document.getElementById('ce-bed-music');
    if (!sel || !items.length) return;
    sel.innerHTML = '<option value="">None</option>' +
      items.map(i => `<option value="${escAttr(i.path)}"${comp.bed_music_file === i.path ? ' selected' : ''}>${escAttr(i.name)}</option>`).join('');
    sel.onchange = () => _cePatchComp({ bed_music_file: sel.value });
  }).catch(() => {});

  // SFX add button
  const addSfxBtn = document.getElementById('ce-add-sfx-btn');
  if (addSfxBtn) {
    addSfxBtn.onclick = async () => {
      try {
        await api('POST', '/compositions/' + _compEditorId + '/sfx', { at_sec: 0, file: '', gain_db: -6 });
        const c = await api('GET', '/compositions/' + _compEditorId);
        renderCERightRail(c);
        // sfx panel starts collapsed after re-render — open it
        const sfxBody = document.getElementById('ce-panel-body-sfx');
        if (sfxBody && sfxBody.style.display === 'none') _cePanelToggle('sfx');
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    };
  }
}
