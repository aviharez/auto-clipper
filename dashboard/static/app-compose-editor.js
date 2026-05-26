// ── Compose Editor ────────────────────────────────────────────────────────────

let _compEditorId = null;
let _compEditorPoll = null;
let _renderPoll = null;
let _wfPeaks = [];          // cached peaks for current composition
let _wfDuration = 0;        // cached voiceover duration
const _segPatchTimers = {};
const _RENDER_ACTIVE = ['render_queued', 'rendering'];
const _FINALIZE_ACTIVE = ['finalize_queued', 'finalizing'];
const _FINALIZED_STATES = ['finalized', 'delivered_local', 'delivered_gdrive'];

async function showComposeEditor(compId) {
  clearTimeout(_composePoll);
  clearTimeout(_listPoll);
  clearTimeout(_detailPoll);
  clearTimeout(_compEditorPoll);
  clearTimeout(_renderPoll);
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

  const segCount = (comp.segments || []).filter(s => s.status !== 'failed').length;
  const renderBtnDisabled = segCount === 0 ? 'disabled' : '';
  const renderBtnLabel = _RENDER_ACTIVE.includes(comp.status) ? 'Rendering…' : 'Render preview';
  const hasRender = !!(comp.last_render_path);
  const isFinalized = _FINALIZED_STATES.includes(comp.status);
  const isFinalizing = _FINALIZE_ACTIVE.includes(comp.status);
  const finalizeBtnDisabled = (!hasRender || isFinalizing) ? 'disabled' : '';
  const finalizeBtnLabel = isFinalizing ? 'Finalizing…' : 'Finalize video';

  app.innerHTML = `
    <div class="compose-editor">
      <div class="compose-editor-header">
        <a class="breadcrumb-back" href="#compose" onclick="location.hash='compose';return false;">← Compose</a>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-title" id="ce-title">${escAttr(comp.title)}</span>
        <div style="flex:1"></div>
        <button class="btn btn-primary btn-sm" id="ce-render-btn" ${renderBtnDisabled}
                style="margin-right:8px">${renderBtnLabel}</button>
        <div class="ce-split-btn" style="margin-right:8px">
          <button class="btn btn-ghost btn-sm ce-split-main" id="ce-save-btn">Save draft</button>
          <button class="btn btn-ghost btn-sm ce-split-arrow" id="ce-split-arrow" aria-label="More actions">▾</button>
          <div class="ce-split-menu" id="ce-split-menu" style="display:none">
            <button class="ce-split-item" id="ce-finalize-btn" ${finalizeBtnDisabled}>${finalizeBtnLabel}</button>
          </div>
        </div>
        ${isFinalized ? `<button class="btn btn-success btn-sm" id="ce-deliver-btn" style="margin-right:8px">Deliver</button>` : ''}
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
  if (comp.voiceover_source) await _ceLoadVoicePeaks(compId);
  renderCESegments(comp.segments || []);
  renderCERightRail(comp);
  setupCEAddSegment(compId);
  setupCERenderBtn(compId, comp);
  _setupCEFinalizeBtn(compId, comp);
  _setupCEDeliverBtn(compId);
  renderCETimeline(comp);

  // 3.5b: start polling if any segment is downloading
  if ((comp.segments || []).some(s => s.status === 'downloading')) {
    _startSegIngestPoll(compId);
  }

  // 3.9: restore video player if already rendered/finalized, or resume poll if in-flight
  if (comp.status === 'rendered' || _FINALIZED_STATES.includes(comp.status)) {
    _showCenterVideo(compId);
  } else if (_RENDER_ACTIVE.includes(comp.status)) {
    _startRenderPoll(compId);
  } else if (_FINALIZE_ACTIVE.includes(comp.status)) {
    _startFinalizePoll(compId);
  }
}

// ── 3.9: Render button + render polling ────────────────────────────────────

function setupCERenderBtn(compId, comp) {
  const btn = document.getElementById('ce-render-btn');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Queuing…';
    try {
      await api('POST', '/compositions/' + compId + '/render');
      btn.textContent = 'Rendering…';
      _startRenderPoll(compId);
    } catch (e) {
      toast('Render error: ' + e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Render preview';
    }
  };
}

function _startRenderPoll(compId) {
  clearTimeout(_renderPoll);
  _renderPoll = setTimeout(async () => {
    if (_compEditorId !== compId) return;
    try {
      const comp = await api('GET', '/compositions/' + compId);
      const pillEl = document.querySelector('.compose-editor-header .pill');
      if (pillEl) pillEl.outerHTML = badge(comp.status);
      const btn = document.getElementById('ce-render-btn');
      if (comp.status === 'rendered' || _FINALIZED_STATES.includes(comp.status)) {
        if (btn) { btn.disabled = false; btn.textContent = 'Re-render'; }
        _showCenterVideo(compId);
        _updateFinalizeBtn(comp);
        return;
      } else if (comp.status === 'failed') {
        if (btn) { btn.disabled = false; btn.textContent = 'Render preview'; }
        _showCenterError(comp.error || 'Render failed');
        return;
      }
      _startRenderPoll(compId);
    } catch (_) {
      _startRenderPoll(compId);
    }
  }, 2500);
}

function _startFinalizePoll(compId) {
  clearTimeout(_renderPoll);
  _renderPoll = setTimeout(async () => {
    if (_compEditorId !== compId) return;
    try {
      const comp = await api('GET', '/compositions/' + compId);
      const pillEl = document.querySelector('.compose-editor-header .pill');
      if (pillEl) pillEl.outerHTML = badge(comp.status);
      if (_FINALIZED_STATES.includes(comp.status)) {
        _updateFinalizeBtn(comp);
        _injectDeliverBtn(compId);
        toast('Finalized! Ready to deliver.', 'success');
        return;
      } else if (comp.status === 'failed') {
        _updateFinalizeBtn(comp);
        toast('Finalize failed: ' + (comp.error || ''), 'error');
        return;
      }
      _startFinalizePoll(compId);
    } catch (_) {
      _startFinalizePoll(compId);
    }
  }, 2500);
}

function _updateFinalizeBtn(comp) {
  const btn = document.getElementById('ce-finalize-btn');
  if (!btn) return;
  const hasRender = !!(comp.last_render_path);
  const isFinalizing = _FINALIZE_ACTIVE.includes(comp.status);
  btn.disabled = !hasRender || isFinalizing;
  btn.textContent = isFinalizing ? 'Finalizing…' : 'Finalize video';
}

function _injectDeliverBtn(compId) {
  if (document.getElementById('ce-deliver-btn')) return;
  const splitBtn = document.querySelector('.ce-split-btn');
  if (!splitBtn) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn-success btn-sm';
  btn.id = 'ce-deliver-btn';
  btn.textContent = 'Deliver';
  btn.style.marginRight = '8px';
  splitBtn.parentNode.insertBefore(btn, splitBtn);
  _setupCEDeliverBtn(compId);
}

function _setupCEFinalizeBtn(compId, comp) {
  const saveBtn = document.getElementById('ce-save-btn');
  const arrowBtn = document.getElementById('ce-split-arrow');
  const menu = document.getElementById('ce-split-menu');
  const finalizeBtn = document.getElementById('ce-finalize-btn');

  if (saveBtn) {
    saveBtn.onclick = () => toast('Draft saved (all changes are auto-persisted)');
  }

  if (arrowBtn && menu) {
    arrowBtn.onclick = (e) => {
      e.stopPropagation();
      const open = menu.style.display !== 'none';
      menu.style.display = open ? 'none' : 'block';
    };
    document.addEventListener('click', () => { if (menu) menu.style.display = 'none'; }, { once: false });
  }

  if (finalizeBtn) {
    finalizeBtn.onclick = async () => {
      if (menu) menu.style.display = 'none';
      finalizeBtn.disabled = true;
      finalizeBtn.textContent = 'Finalizing…';
      try {
        await api('POST', '/compositions/' + compId + '/finalize');
        _startFinalizePoll(compId);
      } catch (e) {
        toast('Finalize error: ' + e.message, 'error');
        _updateFinalizeBtn(comp);
      }
    };
  }
}

function _setupCEDeliverBtn(compId) {
  const btn = document.getElementById('ce-deliver-btn');
  if (!btn) return;
  btn.onclick = async (e) => {
    e.stopPropagation();
    // Show a small inline menu
    let menu = document.getElementById('ce-deliver-menu');
    if (menu) { menu.remove(); return; }
    menu = document.createElement('div');
    menu.id = 'ce-deliver-menu';
    menu.className = 'ce-split-menu';
    menu.style.cssText = 'display:block;right:0;left:auto;top:calc(100% + 4px)';
    menu.innerHTML = `
      <button class="ce-split-item" data-deliverer="local">Local folder</button>
      <button class="ce-split-item" data-deliverer="gdrive">Google Drive</button>
    `;
    btn.style.position = 'relative';
    btn.appendChild(menu);
    menu.querySelectorAll('.ce-split-item').forEach(item => {
      item.onclick = async (ev) => {
        ev.stopPropagation();
        menu.remove();
        btn.disabled = true;
        btn.textContent = 'Delivering…';
        try {
          const result = await api('POST', '/compositions/' + compId + '/deliver', { deliverer: item.dataset.deliverer });
          toast('Delivered: ' + result.status, 'success');
          btn.textContent = 'Delivered ✓';
        } catch (err) {
          toast('Deliver error: ' + err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Deliver';
        }
      };
    });
    document.addEventListener('click', () => { menu.remove(); }, { once: true });
  };
}

function _showCenterVideo(compId) {
  const center = document.getElementById('ce-center');
  if (!center) return;
  const t = Date.now();
  center.innerHTML = `
    <video id="ce-preview-video"
           src="/compositions/${compId}/render?t=${t}"
           controls
           style="width:100%;height:100%;object-fit:contain;background:#000;border-radius:8px">
    </video>`;
}

function _showCenterError(msg) {
  const center = document.getElementById('ce-center');
  if (!center) return;
  center.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;padding:16px">
      <div style="color:#f87171;font-size:14px;font-weight:600">Render failed</div>
      <div style="color:var(--text-dim);font-size:11px;white-space:pre-wrap;max-width:300px;text-align:center">${escHtml(msg.slice(0, 400))}</div>
      <div style="color:var(--text-muted);font-size:11px">Fix the issue and click Render preview again.</div>
    </div>`;
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
  // Enable render button iff ≥1 non-failed segment and not actively rendering
  const btn = document.getElementById('ce-render-btn');
  if (btn) {
    const activeCount = segments.filter(s => s.status !== 'failed').length;
    const currentlyRendering = btn.textContent === 'Rendering…' || btn.textContent === 'Queuing…';
    if (!currentlyRendering) {
      btn.disabled = activeCount === 0;
    }
  }
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

const _WR_COLORS = ['#3b82f6','#a855f7','#0891b2','#f59e0b','#10b981','#ef4444'];

function _wrColor(i) { return _WR_COLORS[i % _WR_COLORS.length]; }

function _renderWaveformSVG(peaks) {
  if (!peaks || !peaks.length) {
    return `<svg class="ce-wf-svg"><text x="50%" y="50%" text-anchor="middle"
      dominant-baseline="middle" fill="var(--text-dim)" font-size="11">
      No voiceover loaded</text></svg>`;
  }
  const n = peaks.length;
  const bars = peaks.map((p, i) => {
    const h = Math.max(2, p * 100);
    const y = (100 - h) / 2;
    return `<rect x="${i}" y="${y.toFixed(1)}" width="1" height="${h.toFixed(1)}" fill="var(--accent)" opacity="0.7"/>`;
  }).join('');
  return `<svg class="ce-wf-svg" viewBox="0 0 ${n} 100" preserveAspectRatio="none">${bars}</svg>`;
}

function _renderWaveformRanges(ranges, dur) {
  if (!dur || !ranges.length) return '';
  return ranges.map((r, i) => {
    const left = (r.start_sec / dur * 100).toFixed(2);
    const width = ((r.end_sec - r.start_sec) / dur * 100).toFixed(2);
    const col = _wrColor(i);
    const snippet = r.snippet ? escAttr(r.snippet.slice(0, 20)) : `S${i}`;
    return `
      <div class="ce-wr-block" style="left:${left}%;width:${width}%;background:${col}" data-wr-idx="${i}"></div>
      <div class="ce-wr-handle" style="left:${left}%;background:${col}" data-wr-id="${r.id}" data-side="start"></div>
      <div class="ce-wr-handle" style="left:calc(${left}% + ${width}%);background:${col}" data-wr-id="${r.id}" data-side="end"></div>
      <div class="ce-wr-label" style="left:${left}%;color:${col}">${snippet}</div>
      <div class="ce-wr-time-badge" style="left:calc(${left}% + ${width}% - 28px)">${r.end_sec.toFixed(1)}s</div>`;
  }).join('');
}

function _renderVoiceRangeList(ranges, comp) {
  if (!ranges.length) {
    return `<div style="color:var(--text-dim);font-size:11px;padding:4px 0">
      No ranges — click Auto-split or drag handles above</div>`;
  }
  return ranges.map((r, i) => {
    const col = _wrColor(i);
    const segLabel = (comp.segments || []).find(s => s.idx === r.segment_idx)?.label || `Seg ${r.segment_idx}`;
    return `
      <div class="ce-wr-row">
        <div class="ce-wr-dot" style="background:${col}"></div>
        <span class="ce-wr-snippet" title="${escAttr(r.snippet || segLabel)}">${escHtml(r.snippet || segLabel)}</span>
        <div class="ce-wr-nudge-group">
          <button class="btn btn-ghost btn-sm ce-wr-nudge-btn" data-wr-id="${r.id}" data-field="start_sec" data-delta="-0.1">−</button>
          <input class="form-input ce-wr-time-input" type="number" step="0.1" value="${r.start_sec.toFixed(2)}"
                 data-wr-id="${r.id}" data-field="start_sec" />
          <button class="btn btn-ghost btn-sm ce-wr-nudge-btn" data-wr-id="${r.id}" data-field="start_sec" data-delta="0.1">+</button>
        </div>
        <span style="color:var(--text-dim);font-size:10px;padding:0 2px">→</span>
        <div class="ce-wr-nudge-group">
          <button class="btn btn-ghost btn-sm ce-wr-nudge-btn" data-wr-id="${r.id}" data-field="end_sec" data-delta="-0.1">−</button>
          <input class="form-input ce-wr-time-input" type="number" step="0.1" value="${r.end_sec.toFixed(2)}"
                 data-wr-id="${r.id}" data-field="end_sec" />
          <button class="btn btn-ghost btn-sm ce-wr-nudge-btn" data-wr-id="${r.id}" data-field="end_sec" data-delta="0.1">+</button>
        </div>
        <button class="btn btn-ghost btn-sm ce-wr-snap-btn" data-wr-id="${r.id}">⌖</button>
      </div>`;
  }).join('');
}

function renderCEPanelVoiceover(comp) {
  const voices = [
    { id: 'af_bella',   label: 'Bella (F)' },
    { id: 'af_nicole',  label: 'Nicole (F)' },
    { id: 'am_michael', label: 'Michael (M)' },
    { id: 'am_adam',    label: 'Adam (M)' },
  ];
  const ranges = comp.voice_ranges || [];
  const wfSVG = _renderWaveformSVG(_wfPeaks);
  const wrOverlay = _renderWaveformRanges(ranges, _wfDuration);
  const wrList = _renderVoiceRangeList(ranges, comp);
  const hasVO = !!comp.voiceover_source;

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
        ${comp.voiceover_source ? 'Source: ' + comp.voiceover_source + (_wfDuration ? ' · ' + _wfDuration.toFixed(1) + 's' : '') : 'No voiceover yet'}
      </div>
      ${hasVO ? `
      <div class="ce-divider" style="margin-top:10px">— voice ranges —</div>
      <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
        <span class="form-label" style="margin:0;flex:1">Waveform</span>
        <button class="btn btn-ghost btn-sm" id="ce-wr-auto-btn">Auto-split</button>
      </div>
      <div class="ce-wf-wrap" id="ce-wf-container">
        ${wfSVG}
        <div class="ce-wf-ranges" id="ce-wf-ranges">${wrOverlay}</div>
      </div>
      <div class="ce-wr-list" id="ce-wr-list">${wrList}</div>
      ` : ''}
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

// ── Voiceover waveform helpers ──────────────────────────────────────────────

async function _ceLoadVoicePeaks(compId) {
  try {
    const data = await api('GET', '/compositions/' + compId + '/voiceover/peaks');
    _wfPeaks = data.peaks || [];
    _wfDuration = data.duration_sec || 0;
  } catch (_) {
    _wfPeaks = []; _wfDuration = 0;
  }
}

async function _ceRefreshVoicePanel(compId) {
  await _ceLoadVoicePeaks(compId);
  const comp = await api('GET', '/compositions/' + compId);
  const body = document.getElementById('ce-panel-body-voiceover');
  if (body) {
    body.innerHTML = renderCEPanelVoiceover(comp);
    _ceAttachVoiceHandlers(comp);
  }
}

function _ceRebuildWaveformOverlay(ranges, dur) {
  const el = document.getElementById('ce-wf-ranges');
  if (el) el.innerHTML = _renderWaveformRanges(ranges, dur);
  const listEl = document.getElementById('ce-wr-list');
  if (listEl) {
    // need comp for segment labels — re-fetch asynchronously
    api('GET', '/compositions/' + _compEditorId).then(comp => {
      listEl.innerHTML = _renderVoiceRangeList(comp.voice_ranges || [], comp);
      _ceAttachRangeListHandlers(comp.voice_ranges || []);
    }).catch(() => {});
  }
}

let _wrDrag = null; // { rangeId, side, containerRect, dur, allRanges }
let _wrDragListenersAdded = false;

// Document-level mousemove/mouseup are wired once per page load.
// Per-render only re-attaches mousedown on new handle elements.
function _ceInitDragListeners() {
  if (_wrDragListenersAdded) return;
  _wrDragListenersAdded = true;

  document.addEventListener('mousemove', e => {
    if (!_wrDrag) return;
    const pct = Math.max(0, Math.min(1, (e.clientX - _wrDrag.containerRect.left) / _wrDrag.containerRect.width));
    const t = Math.round(pct * _wrDrag.dur * 100) / 100;
    const r = _wrDrag.allRanges.find(r => r.id === _wrDrag.rangeId);
    if (!r) return;
    if (_wrDrag.side === 'start') {
      r.start_sec = Math.min(t, r.end_sec - 0.1);
    } else {
      r.end_sec = Math.max(t, r.start_sec + 0.1);
    }
    const el = document.getElementById('ce-wf-ranges');
    if (el) {
      el.innerHTML = _renderWaveformRanges(_wrDrag.allRanges, _wrDrag.dur);
      // Re-wire only the mousedown on newly inserted handles
      _ceWireHandleMousedown(_wrDrag.allRanges, _wrDrag.dur);
    }
  });

  document.addEventListener('mouseup', async () => {
    if (!_wrDrag) return;
    const drag = _wrDrag;
    _wrDrag = null;
    try {
      await api('PUT', '/compositions/' + _compEditorId + '/voice-ranges', { ranges: drag.allRanges });
      _ceRebuildWaveformOverlay(drag.allRanges, drag.dur);
    } catch (e) { toast('Range save failed: ' + e.message, 'error'); }
  });
}

function _ceWireHandleMousedown(ranges, dur) {
  const container = document.getElementById('ce-wf-container');
  if (!container || !dur) return;
  container.querySelectorAll('.ce-wr-handle').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const rangeId = handle.dataset.wrId;
      const side = handle.dataset.side;
      const r = ranges.find(r => r.id === rangeId);
      if (!r) return;
      _wrDrag = {
        rangeId, side,
        containerRect: container.getBoundingClientRect(),
        dur, allRanges: ranges.map(x => ({ ...x })),
      };
    });
  });
}

function _ceAttachWaveformDrag(ranges, dur) {
  _ceInitDragListeners();
  _ceWireHandleMousedown(ranges, dur);
}

function _ceAttachRangeListHandlers(ranges) {
  document.querySelectorAll('.ce-wr-nudge-btn').forEach(btn => {
    btn.onclick = async () => {
      const rangeId = btn.dataset.wrId;
      const field = btn.dataset.field;
      const delta = parseFloat(btn.dataset.delta);
      const r = ranges.find(r => r.id === rangeId);
      if (!r) return;
      const updated = { ...r, [field]: Math.max(0, Math.round((r[field] + delta) * 100) / 100) };
      const newRanges = ranges.map(x => x.id === rangeId ? updated : x);
      try {
        await api('PUT', '/compositions/' + _compEditorId + '/voice-ranges', { ranges: newRanges });
        _ceRebuildWaveformOverlay(newRanges, _wfDuration);
      } catch (e) { toast('Range save failed: ' + e.message, 'error'); }
    };
  });

  document.querySelectorAll('.ce-wr-time-input').forEach(input => {
    input.onchange = async () => {
      const rangeId = input.dataset.wrId;
      const field = input.dataset.field;
      const val = Math.max(0, parseFloat(input.value) || 0);
      const r = ranges.find(r => r.id === rangeId);
      if (!r) return;
      const newRanges = ranges.map(x => x.id === rangeId ? { ...x, [field]: val } : x);
      try {
        await api('PUT', '/compositions/' + _compEditorId + '/voice-ranges', { ranges: newRanges });
        _ceRebuildWaveformOverlay(newRanges, _wfDuration);
      } catch (e) { toast('Range save failed: ' + e.message, 'error'); }
    };
  });

  document.querySelectorAll('.ce-wr-snap-btn').forEach(btn => {
    btn.onclick = async () => {
      const rangeId = btn.dataset.wrId;
      btn.textContent = '…';
      btn.disabled = true;
      try {
        // Snap both sides
        const r1 = await api('GET', `/compositions/${_compEditorId}/voice-ranges/snap?range_id=${rangeId}&side=start`);
        const r2 = await api('GET', `/compositions/${_compEditorId}/voice-ranges/snap?range_id=${rangeId}&side=end`);
        const newRanges = r2.ranges || [];
        _ceRebuildWaveformOverlay(newRanges, _wfDuration);
        toast('Snapped to silence', 'success');
      } catch (e) { toast('Snap failed: ' + e.message, 'error'); }
      finally { btn.textContent = '⌖'; btn.disabled = false; }
    };
  });
}

function _ceAttachVoiceHandlers(comp) {
  const ranges = comp.voice_ranges || [];

  // Auto-split
  const autoBtn = document.getElementById('ce-wr-auto-btn');
  if (autoBtn) {
    autoBtn.onclick = async () => {
      autoBtn.disabled = true;
      autoBtn.textContent = 'Splitting…';
      try {
        const result = await api('POST', '/compositions/' + _compEditorId + '/voice-ranges/auto');
        const newRanges = result.ranges || [];
        const wfEl = document.getElementById('ce-wf-ranges');
        if (wfEl) wfEl.innerHTML = _renderWaveformRanges(newRanges, _wfDuration);
        const listEl = document.getElementById('ce-wr-list');
        if (listEl) listEl.innerHTML = _renderVoiceRangeList(newRanges, comp);
        _ceAttachWaveformDrag(newRanges, _wfDuration);
        _ceAttachRangeListHandlers(newRanges);
        toast(`${newRanges.length} range${newRanges.length !== 1 ? 's' : ''} set`, 'success');
      } catch (e) { toast('Auto-split failed: ' + e.message, 'error'); }
      finally { autoBtn.disabled = false; autoBtn.textContent = 'Auto-split'; }
    };
  }

  _ceAttachWaveformDrag(ranges, _wfDuration);
  _ceAttachRangeListHandlers(ranges);
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

  // Voiceover upload
  const voUploadBtn = document.getElementById('ce-vo-upload-btn');
  if (voUploadBtn) {
    voUploadBtn.onclick = async () => {
      const f = document.getElementById('ce-vo-file')?.files[0];
      if (!f) { toast('Choose a WAV, MP3, or M4A file first', ''); return; }
      voUploadBtn.disabled = true;
      voUploadBtn.textContent = 'Uploading…';
      const statusEl = document.getElementById('ce-vo-status');
      if (statusEl) statusEl.textContent = 'Uploading…';
      try {
        const fd = new FormData();
        fd.append('file', f);
        const res = await fetch('/api/compositions/' + _compEditorId + '/voiceover/upload', { method: 'POST', body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || res.statusText);
        }
        const result = await res.json();
        if (statusEl) statusEl.textContent = `Source: upload · ${result.duration_sec.toFixed(1)}s`;
        const fnEl = document.getElementById('ce-vo-fname');
        if (fnEl) fnEl.textContent = '';
        document.getElementById('ce-vo-file').value = '';
        toast(`Voiceover uploaded (${result.duration_sec.toFixed(1)}s)`, 'success');
        await _ceRefreshVoicePanel(_compEditorId);
      } catch (e) {
        if (statusEl) statusEl.textContent = 'Upload failed';
        toast('Upload error: ' + e.message, 'error');
      } finally {
        voUploadBtn.disabled = false;
        voUploadBtn.textContent = 'Upload';
      }
    };
  }
  const kokoroBtn = document.getElementById('ce-kokoro-btn');
  if (kokoroBtn) {
    kokoroBtn.onclick = async () => {
      const voice = document.getElementById('ce-kokoro-voice')?.value;
      _cePatchComp({ voiceover_kokoro_voice: voice });
      kokoroBtn.disabled = true;
      kokoroBtn.textContent = 'Generating…';
      const statusEl = document.getElementById('ce-vo-status');
      if (statusEl) statusEl.textContent = 'Generating voiceover…';
      try {
        const result = await api('POST', '/compositions/' + _compEditorId + '/voiceover/kokoro');
        if (statusEl) statusEl.textContent = `Source: kokoro · ${result.duration_sec.toFixed(1)}s`;
        toast('Voiceover generated (' + result.duration_sec.toFixed(1) + 's)', 'success');
        await _ceRefreshVoicePanel(_compEditorId);
      } catch (e) {
        if (statusEl) statusEl.textContent = 'Generation failed';
        toast('Kokoro error: ' + e.message, 'error');
      } finally {
        kokoroBtn.disabled = false;
        kokoroBtn.textContent = 'Generate voiceover';
      }
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

  // Load SFX library async and populate all SFX file selects
  api('GET', '/sfx-library').then(items => {
    if (!items.length) return;
    $$('.ce-sfx-row').forEach(row => {
      const sfxId = row.dataset.sfxId;
      const sel = row.querySelector('select');
      if (!sel) return;
      const currentFile = (comp.sfx || []).find(s => s.id === sfxId)?.file || '';
      sel.innerHTML = '<option value="">-- pick SFX --</option>' +
        items.map(i => `<option value="${escAttr(i.path)}"${i.path === currentFile ? ' selected' : ''}>${escAttr(i.name)}</option>`).join('');
      sel.onchange = () => _cePatchSFX(sfxId, { file: sel.value });
    });
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

  // Voice ranges (waveform drag + list nudge/snap)
  _ceAttachVoiceHandlers(comp);
}

// ── Timeline (Phase D: Steps 3.10 – 3.12) ────────────────────────────────

let _tl = null; // { pxPerSec, totalDur, comp, peaks }

// Entry point: called from showComposeEditor and on any re-render.
// Also called from _ceTLZoom — reuses existing _tl.pxPerSec.
function renderCETimeline(comp, peaks) {
  const target = document.querySelector('.compose-timeline-placeholder') ||
                 document.getElementById('ce-timeline');
  if (!target) return;

  const totalDur = comp.last_render_duration || comp.target_sec || 38;
  const segs = (comp.segments || []).filter(s => _tlSegDur(s) > 0 && s.status !== 'failed');

  // Keep previous zoom level across re-renders; fit on first render
  const pxPerSec = (_tl && _tl.pxPerSec) ? _tl.pxPerSec : _ceTLFitPxPerSec(target, totalDur);
  _tl = { pxPerSec, totalDur, comp, peaks: peaks || [] };

  target.outerHTML = _ceTLBuildHTML(comp, peaks || [], segs, totalDur, pxPerSec);

  // Async-load voiceover peaks if not supplied
  if (!peaks || !peaks.length) _ceTLLoadPeaks(comp);
  _ceTLSetupHover(comp);
  _ceTLSetupDrag(segs, comp);
}

function _ceTLFitPxPerSec(containerEl, totalDur) {
  const w = (containerEl ? containerEl.offsetWidth : 900) - 80 - 24;
  return Math.max(4, Math.min(80, w / totalDur));
}

function _tlSegDur(seg) {
  if (seg.duration != null) return parseFloat(seg.duration);
  if (seg.trim_out != null) return Math.max(0, parseFloat(seg.trim_out) - parseFloat(seg.trim_in || 0));
  return 0;
}

function _ceTLZoom(action) {
  if (!_tl) return;
  if (action === 'fit') {
    const scroll = document.getElementById('ce-tl-scroll');
    const w = scroll ? Math.max(100, scroll.clientWidth - 80 - 16) : 400;
    _tl.pxPerSec = w / _tl.totalDur;
  } else {
    _tl.pxPerSec = action > 0
      ? Math.min(160, _tl.pxPerSec * 1.5)
      : Math.max(3, _tl.pxPerSec / 1.5);
  }
  renderCETimeline(_tl.comp, _tl.peaks);
}

async function _ceTLLoadPeaks(comp) {
  try {
    const data = await api('GET', '/compositions/' + comp.id + '/voiceover/peaks');
    if (_tl && data.peaks && data.peaks.length > 0) {
      _tl.peaks = data.peaks;
      const el = document.getElementById('ce-tl-voice');
      if (el) el.innerHTML = _ceTLVoiceContentHTML(data.peaks, _tl.totalDur, _tl.pxPerSec, comp.voice_ranges || []);
    }
  } catch (_) {}
}

// ── HTML builders ──────────────────────────────────────────────────────────

function _ceTLBuildHTML(comp, peaks, segs, totalDur, pxPerSec) {
  const contentW = Math.max(200, totalDur * pxPerSec);
  const innerW = contentW + 80 + 24;
  const segInfo = `${segs.length} seg${segs.length !== 1 ? 's' : ''} · ${totalDur.toFixed(1)}s`;

  return `
<div class="ce-timeline" id="ce-timeline">
  <div class="ce-tl-header">
    <span class="ce-tl-title">Timeline</span>
    <span class="ce-tl-info">${segInfo}</span>
    <div style="flex:1"></div>
    <span class="ce-tl-hint"><span style="color:var(--accent)">↔</span> hover · <span style="color:var(--accent)">⇆</span> drag to reorder</span>
    <div class="ce-tl-sep"></div>
    <div class="ce-tl-zoom">
      <button onclick="_ceTLZoom('fit')">fit</button>
      <span class="ce-tl-zoom-label" id="ce-tl-zoom-label">${Math.round(pxPerSec)} px/s</span>
      <button onclick="_ceTLZoom(-1)">−</button>
      <button onclick="_ceTLZoom(1)">+</button>
    </div>
  </div>
  <div class="ce-tl-scroll" id="ce-tl-scroll">
    <div class="ce-tl-inner" id="ce-tl-inner" style="width:${innerW.toFixed(0)}px">
      ${_ceTLRulerHTML(totalDur, pxPerSec)}
      <div class="ce-tl-tracks" id="ce-tl-tracks">
        <div class="ce-tl-playhead" id="ce-tl-playhead" style="display:none"></div>
        <div class="ce-tl-hover-zone" id="ce-tl-hover-zone"></div>
        ${_ceTLSegsHTML(segs, comp, pxPerSec)}
        ${_ceTLHookHTML(comp, pxPerSec)}
        ${_ceTLVoiceHTML(peaks, totalDur, pxPerSec, comp.voice_ranges || [])}
        ${_ceTLMusicHTML(totalDur, pxPerSec)}
        ${_ceTLSFXHTML(comp.sfx || [], totalDur, pxPerSec)}
      </div>
    </div>
  </div>
  <div class="ce-tl-thumb-pop" id="ce-tl-thumb-pop" style="display:none">
    <img class="ce-tl-thumb-img" id="ce-tl-thumb-img" src="" alt="" />
    <div class="ce-tl-timecode" id="ce-tl-timecode"></div>
  </div>
</div>`;
}

function _ceTLRulerHTML(totalDur, pxPerSec) {
  let ticks = '';
  for (let t = 0; t <= Math.ceil(totalDur) + 1; t++) {
    const isBig = t % 5 === 0;
    const left = (80 + t * pxPerSec).toFixed(1);
    ticks += `<div class="ce-tl-tick${isBig ? ' big' : ''}" style="left:${left}px">${isBig ? `<span>${t}s</span>` : ''}</div>`;
  }
  return `<div class="ce-tl-ruler" id="ce-tl-ruler">${ticks}</div>`;
}

function _ceTLSegsHTML(segs, comp, pxPerSec) {
  let cumulPx = 0;
  let blocks = '';
  let tranMarks = '';

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const dur = _tlSegDur(seg);
    const x = cumulPx;
    const w = Math.max(2, dur * pxPerSec - 2);
    const color = KIND_COLORS[seg.kind] || '#888';
    const kindLbl = KIND_LABELS[seg.kind] || seg.kind;
    const rawLabel = seg.label || (seg.source_url ? seg.source_url.slice(0, 22) : `Seg ${i + 1}`);
    const dispLabel = rawLabel.length > 18 ? rawLabel.slice(0, 18) + '…' : rawLabel;

    blocks += `<div class="ce-tl-seg-block" draggable="true"
      data-tl-seg-id="${seg.id}" data-tl-seg-i="${i}"
      style="left:${x.toFixed(1)}px;width:${w.toFixed(1)}px;background:${color}">
      <div class="ce-tl-seg-block-kind">${kindLbl}</div>
      <div class="ce-tl-seg-block-label">${escHtml(dispLabel)}</div>
      <div class="ce-tl-seg-block-dur">${dur.toFixed(1)}s</div>
    </div>`;

    cumulPx += dur * pxPerSec;

    if (i < segs.length - 1 && seg.transition_to_next && seg.transition_to_next !== 'cut') {
      tranMarks += `<div class="ce-tl-trans-mark" style="left:${(cumulPx - 7).toFixed(1)}px"></div>`;
    }
  }

  return `
<div class="ce-tl-track" style="height:56px;background:var(--bg)">
  <div class="ce-tl-lbl">Segs<small>drag to reorder</small></div>
  <div class="ce-tl-content" id="ce-tl-segs">
    ${blocks}${tranMarks}
    <div class="ce-tl-drop-ind" id="ce-tl-drop-ind" style="display:none"></div>
  </div>
</div>`;
}

function _ceTLHookHTML(comp, pxPerSec) {
  const hookW = comp.hook_text ? (1.5 * pxPerSec) : 0;
  const hookBar = hookW > 0
    ? `<div class="ce-tl-hook-bar" style="left:0;width:${hookW.toFixed(1)}px">HOOK · 1.5s</div>`
    : '';
  return `
<div class="ce-tl-track" style="height:22px">
  <div class="ce-tl-lbl">Hook</div>
  <div class="ce-tl-content">${hookBar}</div>
</div>`;
}

function _ceTLVoiceContentHTML(peaks, totalDur, pxPerSec, voiceRanges) {
  const contentW = Math.max(1, totalDur * pxPerSec);
  const trackH = 30;
  let svg = '';
  if (peaks && peaks.length > 0) {
    const rects = peaks.map((p, i) => {
      const h = Math.max(1, p * (trackH - 4));
      const x = (i / peaks.length) * contentW;
      return `<rect x="${x.toFixed(1)}" y="${((trackH - h) / 2).toFixed(1)}" width="1.5" height="${h.toFixed(1)}" fill="var(--accent)" opacity="0.5"/>`;
    }).join('');
    svg = `<svg width="${contentW.toFixed(0)}" height="${trackH}" preserveAspectRatio="none" style="position:absolute;inset:0;pointer-events:none">${rects}</svg>`;
  }
  const rangeLines = (voiceRanges || []).filter((_, i) => i > 0).map(r => {
    const x = (r.start_sec / totalDur) * contentW;
    return `<div style="position:absolute;left:${x.toFixed(1)}px;top:0;bottom:0;border-left:1.5px dashed var(--accent);pointer-events:none"></div>`;
  }).join('');
  return svg + rangeLines;
}

function _ceTLVoiceHTML(peaks, totalDur, pxPerSec, voiceRanges) {
  return `
<div class="ce-tl-track" style="height:30px">
  <div class="ce-tl-lbl">Voice<small>from wav</small></div>
  <div class="ce-tl-content" id="ce-tl-voice">${_ceTLVoiceContentHTML(peaks, totalDur, pxPerSec, voiceRanges)}</div>
</div>`;
}

function _ceTLMusicHTML(totalDur, pxPerSec) {
  // Waveform data comes in Step 3.21 when music library is bundled
  return `
<div class="ce-tl-track" style="height:24px">
  <div class="ce-tl-lbl">Music</div>
  <div class="ce-tl-content" id="ce-tl-music"></div>
</div>`;
}

function _ceTLSFXHTML(sfxDrops, totalDur, pxPerSec) {
  const contentW = Math.max(1, totalDur * pxPerSec);
  const dots = sfxDrops.map((s, i) => {
    const x = Math.min(contentW - 7, Math.max(0, s.at_sec * pxPerSec));
    const name = s.file ? s.file.split(/[\\/]/).pop().replace(/\.\w+$/, '') : '';
    return `<div class="ce-tl-sfx-dot" style="left:${x.toFixed(1)}px">
      <div class="ce-tl-sfx-num">${i + 1}</div>
      ${name ? `<span class="ce-tl-sfx-name">${escHtml(name)}</span>` : ''}
    </div>`;
  }).join('');
  return `
<div class="ce-tl-track" style="height:26px">
  <div class="ce-tl-lbl">SFX</div>
  <div class="ce-tl-content" id="ce-tl-sfx">${dots}</div>
</div>`;
}

// ── Step 3.11: Hover-scrub ────────────────────────────────────────────────

function _ceTLSetupHover(comp) {
  const hoverZone = document.getElementById('ce-tl-hover-zone');
  const playhead  = document.getElementById('ce-tl-playhead');
  if (!hoverZone || !playhead) return;

  hoverZone.addEventListener('mousemove', (e) => {
    if (!_tl) return;
    const x = e.offsetX;
    const t = Math.max(0, Math.min(_tl.totalDur, x / _tl.pxPerSec));

    // Move playhead inside the tracks (offset from left edge of tracks div)
    playhead.style.display = '';
    playhead.style.left = (80 + x) + 'px';

    // Show thumbnail + update video only when a render exists
    if (comp.last_render_duration) {
      const n = Math.max(1, Math.round(t * 2)); // 0.5s intervals
      const img     = document.getElementById('ce-tl-thumb-img');
      const tc      = document.getElementById('ce-tl-timecode');
      const thumbPop = document.getElementById('ce-tl-thumb-pop');

      if (img) img.src = `/compositions/${comp.id}/thumb/${n}`;
      if (tc)  tc.textContent = t.toFixed(1) + 's';

      if (thumbPop) {
        // Use fixed positioning to escape the overflow:hidden timeline container
        const scroll = document.getElementById('ce-tl-scroll');
        const scrollTop = scroll ? scroll.getBoundingClientRect().top : 0;
        thumbPop.style.display = 'flex';
        thumbPop.style.position = 'fixed';
        thumbPop.style.left = e.clientX + 'px';
        thumbPop.style.top  = (scrollTop - 106) + 'px';
        thumbPop.style.transform = 'translateX(-50%)';
        thumbPop.style.zIndex = '999';
      }

      // Seek the center-pane video to the hovered time (if not paused)
      const video = document.getElementById('ce-preview-video');
      if (video && video.readyState >= 1) video.currentTime = t;
    }
  });

  hoverZone.addEventListener('mouseleave', () => {
    playhead.style.display = 'none';
    const thumbPop = document.getElementById('ce-tl-thumb-pop');
    if (thumbPop) thumbPop.style.display = 'none';
  });
}

// ── Step 3.12: Drag-to-reorder segment blocks ─────────────────────────────

function _ceTLSetupDrag(segs, comp) {
  let dragSrcId = null;

  document.querySelectorAll('.ce-tl-seg-block').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      dragSrcId = el.dataset.tlSegId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSrcId);
      // Defer class add so browser captures the un-dimmed image as drag ghost
      setTimeout(() => el.classList.add('dragging'), 0);
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      const ind = document.getElementById('ce-tl-drop-ind');
      if (ind) ind.style.display = 'none';
      dragSrcId = null;
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!dragSrcId || el.dataset.tlSegId === dragSrcId) return;
      const rect = el.getBoundingClientRect();
      const insertAfter = e.clientX > rect.left + rect.width / 2;
      const ind = document.getElementById('ce-tl-drop-ind');
      const content = document.getElementById('ce-tl-segs');
      if (ind && content) {
        const cr = content.getBoundingClientRect();
        const indX = (insertAfter ? rect.right : rect.left) - cr.left;
        ind.style.left = indX + 'px';
        ind.style.display = '';
      }
    });

    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      const ind = document.getElementById('ce-tl-drop-ind');
      if (ind) ind.style.display = 'none';
      const targetId = el.dataset.tlSegId;
      if (!dragSrcId || targetId === dragSrcId) { dragSrcId = null; return; }

      // Build new order: all segment IDs (including non-shown ones) with src moved
      const allIds = (comp.segments || []).map(s => s.id);
      const without = allIds.filter(id => id !== dragSrcId);
      const tgtIdx = without.indexOf(targetId);
      const insertAfter = e.clientX > el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2;
      without.splice(insertAfter ? tgtIdx + 1 : tgtIdx, 0, dragSrcId);
      dragSrcId = null;

      try {
        await api('PUT', '/compositions/' + comp.id + '/segments/order', { order: without });
        const updComp = await api('GET', '/compositions/' + comp.id);
        renderCESegments(updComp.segments || []);
        renderCETimeline(updComp, _tl ? _tl.peaks : []);
        if (updComp.last_render_path) _ceTLShowStaleBanner();
      } catch (ex) {
        toast('Reorder failed: ' + ex.message, 'error');
      }
    });
  });
}

function _ceTLShowStaleBanner() {
  if (document.getElementById('ce-stale-banner')) return;
  const editorEl = document.querySelector('.compose-editor');
  if (!editorEl) return;
  const div = document.createElement('div');
  div.id = 'ce-stale-banner';
  div.className = 'ce-stale-banner';
  div.innerHTML = `⚠ Segment order changed — <a href="#" onclick="_ceReRender(event)">re-render to update</a>`;
  const header = editorEl.querySelector('.compose-editor-header');
  if (header) header.insertAdjacentElement('afterend', div);
  else editorEl.prepend(div);
}

function _ceReRender(e) {
  e.preventDefault();
  const b = document.getElementById('ce-stale-banner');
  if (b) b.remove();
  document.getElementById('ce-render-btn')?.click();
}
