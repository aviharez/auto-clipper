// ── Utilities ──────────────────────────────────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const app = document.getElementById('app');
const breadcrumb = document.getElementById('breadcrumb');

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

function fmtDuration(secs) {
  secs = Math.round(secs);
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function fmtSecs(s) {
  return fmtDuration(s);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString();
}

function badge(status) {
  return `<span class="badge badge-${status}">${status.replace(/_/g, ' ')}</span>`;
}

// ── Router ─────────────────────────────────────────────────────────────────

function route() {
  const hash = location.hash.slice(1);
  if (hash === 'history') {
    showHistory();
  } else if (hash.startsWith('job/')) {
    showJobDetail(hash.slice(4));
  } else {
    showJobList();
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

// ── Job List ───────────────────────────────────────────────────────────────

let _listPoll;

// States that mean something is still in flight and worth polling.
const ACTIVE_STATES = new Set([
  'pending','downloading','cutting','transcribing',
  'captioning','creating_hook','assembling','uploading',
]);

async function showJobList() {
  clearTimeout(_listPoll);
  _listPoll = null;
  breadcrumb.innerHTML = '';

  app.innerHTML = `
    <div class="section-header">
      <h2>Jobs</h2>
      <button class="btn btn-primary" id="btn-new">+ New Job</button>
    </div>
    <div id="upload-panel" style="display:none" class="card" style="margin-bottom:16px">
      <div class="upload-area" id="drop-zone">
        <input type="file" id="yaml-input" accept=".yaml,.yml" />
        <div style="font-size:24px">📄</div>
        <strong>Drop your clips YAML here</strong>
        <p>or click to browse</p>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost" id="btn-cancel-upload">Cancel</button>
        <button class="btn btn-primary" id="btn-submit-upload" disabled>Upload &amp; Process</button>
      </div>
    </div>
    <div id="job-list-wrap"><div class="loading">Loading jobs…</div></div>
  `;

  $('#btn-new').onclick = () => {
    const panel = $('#upload-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  };

  $('#btn-cancel-upload').onclick = () => { $('#upload-panel').style.display = 'none'; };

  setupUpload();
  await renderJobList();
}

function setupUpload() {
  const dropZone = $('#drop-zone');
  const fileInput = $('#yaml-input');
  const submitBtn = $('#btn-submit-upload');
  let selectedFile = null;

  dropZone.onclick = () => fileInput.click();
  fileInput.onchange = () => selectFile(fileInput.files[0]);

  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); };
  dropZone.ondragleave = () => dropZone.classList.remove('drag-over');
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
  };

  function selectFile(f) {
    selectedFile = f;
    submitBtn.disabled = false;
    dropZone.querySelector('strong').textContent = f.name;
    dropZone.querySelector('p').textContent = `${(f.size / 1024).toFixed(1)} KB`;
  }

  submitBtn.onclick = async () => {
    if (!selectedFile) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading…';
    try {
      const form = new FormData();
      form.append('yaml_file', selectedFile);
      const res = await fetch('/api/jobs', { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || res.statusText);
      }
      const { job_id } = await res.json();
      toast('Job created! Processing…', 'success');
      $('#upload-panel').style.display = 'none';
      location.hash = 'job/' + job_id;
    } catch (e) {
      toast('Error: ' + e.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload & Process';
    }
  };
}

async function renderJobList() {
  const wrap = document.getElementById('job-list-wrap');
  if (!wrap) return;
  try {
    const jobs = await api('GET', '/jobs');
    if (!jobs.length) {
      wrap.innerHTML = '<div class="empty">No jobs yet. Create one with "+ New Job".</div>';
      return;
    }
    wrap.innerHTML = `<div class="job-list">
      ${jobs.map(j => `
        <div class="job-row" data-id="${j.id}" onclick="location.hash='job/${j.id}'">
          <div>
            <div class="job-url" title="${j.source_url}">${j.source_url}</div>
            <div class="job-meta">${fmtDate(j.created_at)} · ${j.clip_count ?? 0} clips</div>
          </div>
          <div>${badge(j.status)}</div>
          <div class="job-meta">${j.approved_count ?? 0} approved</div>
          <div><button class="btn btn-ghost btn-sm">View →</button></div>
        </div>
      `).join('')}
    </div>`;

    // Poll again only if any job is still working.
    clearTimeout(_listPoll);
    _listPoll = null;
    if (jobs.some(j => ACTIVE_STATES.has(j.status))) {
      _listPoll = setTimeout(renderJobList, 3000);
    }
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="empty">Error loading jobs: ${e.message}</div>`;
  }
}

// ── Job Detail ─────────────────────────────────────────────────────────────

let _detailPoll;
let _currentJobId = null;

function _scheduleDetailPoll(jobId) {
  clearTimeout(_detailPoll);
  if (_currentJobId !== jobId) return;
  _detailPoll = setTimeout(() => renderJobDetail(jobId), 2500);
}

function _restartDetailPoll() {
  if (!_currentJobId) return;
  _scheduleDetailPoll(_currentJobId);
}

async function showJobDetail(jobId) {
  clearTimeout(_detailPoll);
  _detailPoll = null;
  _currentJobId = jobId;
  Object.keys(_bsugg).forEach(k => delete _bsugg[k]);
  Object.keys(_presetDirty).forEach(k => delete _presetDirty[k]);

  breadcrumb.innerHTML = `
    <a href="#" onclick="location.hash='';return false;">Jobs</a>
    <span>/</span>
    <span id="bc-title">…</span>
  `;

  app.innerHTML = `<div class="loading">Loading job…</div>`;
  await renderJobDetail(jobId);
}

async function renderJobDetail(jobId) {
  // Skip re-render while any video is playing or paused mid-playback — a full
  // innerHTML replacement destroys the <video> element and resets its position.
  if ($$('video').some(v => v.currentTime > 0 && !v.ended)) {
    _scheduleDetailPoll(jobId);
    return;
  }

  try {
    await loadPresets();
    const job = await api('GET', `/jobs/${jobId}`);

    // Poll again only while something is still processing. User actions
    // (recut, retry, accept suggestion) re-arm via _restartDetailPoll().
    const jobActive  = ACTIVE_STATES.has(job.status);
    const candsActive = job.candidates?.some(c => ACTIVE_STATES.has(c.status)) ?? false;
    clearTimeout(_detailPoll);
    _detailPoll = null;
    if (jobActive || candsActive) {
      _scheduleDetailPoll(jobId);
    }

    const bc = document.getElementById('bc-title');
    if (bc) bc.textContent = job.source_url.length > 50
      ? job.source_url.slice(0, 50) + '…' : job.source_url;

    const meta = JSON.parse(job.metadata_json || '{}');
    const hasApproved = job.candidates?.some(c => c.approved && c.status === 'ready');

    // Preserve open state of clip bodies before re-render
    const openIds = new Set(
      $$('.clip-body.open').map(el => el.dataset.cid)
    );

    app.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <button class="btn btn-ghost btn-sm" onclick="location.hash=''">← Back</button>
        <h2 style="font-size:15px;font-weight:600;flex:1">${meta.title || job.source_url}</h2>
        ${badge(job.status)}
        ${hasApproved ? `<button class="btn btn-primary" id="btn-publish">↑ Upload Approved</button>` : ''}
        ${job.status === 'failed' ? `<button class="btn btn-ghost" id="btn-retry">↺ Retry</button>` : ''}
      </div>
      <div class="job-info">
        <div><span>Status:</span> <strong>${job.status}</strong></div>
        <div><span>Created:</span> <strong>${fmtDate(job.created_at)}</strong></div>
        <div><span>Clips:</span> <strong>${job.candidates?.length ?? 0}</strong></div>
        ${job.error ? `<div style="color:var(--danger)">${job.error.split('\n')[0]}</div>` : ''}
      </div>
      <div class="clip-list" id="clip-list">
        ${(job.candidates || []).map(c => renderClipCard(c, openIds.has(c.id))).join('')}
        ${!job.candidates?.length ? '<div class="empty">No clips yet. Processing may still be running.</div>' : ''}
      </div>
    `;

    if (hasApproved) {
      $('#btn-publish').onclick = () => publishJob(jobId);
    }
    const retryBtn = document.getElementById('btn-retry');
    if (retryBtn) {
      retryBtn.onclick = () => retryJob(jobId);
    }

    // Attach nudge handlers
    $$('.clip-header').forEach(h => {
      h.onclick = () => {
        const body = h.nextElementSibling;
        const wasOpen = body.classList.contains('open');
        body.classList.toggle('open');
        if (!wasOpen) {
          const cid    = body.dataset.cid;
          const cStart = parseFloat(body.dataset.start);
          const cEnd   = parseFloat(body.dataset.end);
          if (_bsugg[cid] === undefined) fetchBsugg(cid, cStart, cEnd);
        }
      };
    });

    $$('[data-recut]').forEach(btn => {
      btn.onclick = () => triggerRecut(btn.dataset.recut, jobId);
    });

    $$('[data-approve]').forEach(btn => {
      btn.onclick = () => setApproval(btn.dataset.approve, true, jobId);
    });

    $$('[data-reject]').forEach(btn => {
      btn.onclick = () => setApproval(btn.dataset.reject, false, jobId);
    });

    // Nudge buttons
    $$('[data-nudge]').forEach(btn => {
      btn.onclick = () => nudge(btn, jobId);
    });

    // Preset dropdowns
    $$('[data-preset-type]').forEach(sel => {
      sel.onchange = () => changePreset(sel.dataset.cid, sel.dataset.presetType, sel.value, jobId);
    });

  } catch (e) {
    app.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

function renderClipCard(c, forceOpen = false) {
  const dur = c.end - c.start;
  const isOpen = forceOpen || c.status === 'failed';
  const approvedClass = c.approved ? 'approved' : (c.status === 'rejected' ? 'rejected' : '');

  const hasVideo = c.status === 'ready' || c.status === 'approved' || c.status === 'uploaded';

  const cp = _presets?.caption || {};
  const cpKeys = Object.keys(cp);
  const effectiveHookPreset = c.hook_preset || c.caption_preset;
  const presetBlock = cpKeys.length ? `
    <div class="preset-row">
      ${c.needs_caption ? `<div class="preset-field"><label class="preset-label">Caption</label><select class="preset-select" data-preset-type="caption" data-cid="${c.id}">${_presetOptions(c.caption_preset, cp)}</select></div>` : ''}
      ${c.hook_enabled && c.hook_text ? `<div class="preset-field"><label class="preset-label">Hook style</label><select class="preset-select" data-preset-type="hook" data-cid="${c.id}">${_presetOptions(effectiveHookPreset, cp)}</select></div>` : ''}
    </div>` : '';

  return `
  <div class="clip-card ${approvedClass}" id="clip-${c.id}">
    <div class="clip-header">
      <div class="clip-title">${c.title}</div>
      <div class="clip-meta">${fmtSecs(c.start)} – ${fmtSecs(c.end)} · ${fmtDuration(dur)}</div>
      <div style="margin-left:8px">${badge(c.approved ? 'approved' : c.status)}</div>
    </div>
    <div class="clip-body ${isOpen ? 'open' : ''}" data-cid="${c.id}" data-start="${c.start}" data-end="${c.end}">
      <div class="clip-layout">
        <div>
          <div class="clip-video-wrap">
            ${hasVideo
              ? `<video controls src="/video/${c.id}" preload="metadata"></video>`
              : `<div class="clip-video-placeholder">${statusMsg(c)}</div>`
            }
          </div>
          ${hasVideo ? `<div class="clip-video-label">${previewLabel(c)}</div>` : ''}
        </div>
        <div class="clip-controls">
          ${c.hook_text ? `<div style="font-size:12px;color:var(--text-muted)">Hook: <em>${c.hook_text}</em></div>` : ''}
          ${presetBlock}

          <div id="bsugg-${c.id}">${renderBsuggHtml(c.id, _bsugg[c.id], c.start, c.end)}</div>

          <div class="nudge-group">
            <div class="nudge-label">Start</div>
            <div class="nudge-row">
              <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="start" data-delta="-5">−5s</button>
              <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="start" data-delta="-1">−1s</button>
              <span class="nudge-val" id="start-${c.id}">${fmtSecs(c.start)}</span>
              <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="start" data-delta="1">+1s</button>
              <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="start" data-delta="5">+5s</button>
            </div>
          </div>

          <div class="nudge-group">
            <div class="nudge-label">End</div>
            <div class="nudge-row">
              <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="end" data-delta="-5">−5s</button>
              <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="end" data-delta="-1">−1s</button>
              <span class="nudge-val" id="end-${c.id}">${fmtSecs(c.end)}</span>
              <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="end" data-delta="1">+1s</button>
              <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="end" data-delta="5">+5s</button>
            </div>
          </div>

          <div class="clip-actions">
            <button class="btn btn-ghost btn-sm" data-recut="${c.id}">↻ Regenerate</button>
            ${c.approved
              ? `<button class="btn btn-ghost btn-sm" data-reject="${c.id}">✕ Unapprove</button>`
              : `<button class="btn btn-primary btn-sm" data-approve="${c.id}">✓ Approve</button>
                 <button class="btn btn-danger btn-sm" data-reject="${c.id}">✕ Reject</button>`
            }
            ${c.youtube_url ? `<a href="${c.youtube_url}" target="_blank" class="btn btn-ghost btn-sm">▶ YouTube</a>` : ''}
          </div>

          ${c.error ? `<div class="clip-error">${c.error}</div>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

function statusMsg(c) {
  if (c.status === 'pending') return 'Waiting to cut…';
  if (c.status === 'cutting') return 'Cutting…';
  if (c.status === 'failed') return 'Failed';
  return 'Not ready';
}

function previewLabel(c) {
  const parts = [];
  if (c.hook_enabled && c.hook_text) parts.push('hook');
  if (c.needs_caption) parts.push('captions');
  return parts.length ? parts.join(' + ') : 'raw cut';
}

async function changePreset(cid, type, value, jobId) {
  const body = type === 'caption' ? { caption_preset: value } : { hook_preset: value };
  try {
    await api('PUT', `/candidates/${cid}/style`, body);
    _presetDirty[cid] = true;
    toast('Preset saved — click Regenerate to apply');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ── Nudge state (local; committed on Regenerate) ───────────────────────────

const _nudge = {};       // cid -> { start, end }
const _bsugg = {};       // cid -> suggestion object | null (null = fetched, no suggestion)
const _presetDirty = {}; // cid -> true when preset changed but not yet regenerated

// ── Preset cache ───────────────────────────────────────────────────────────

let _presets = null;

async function loadPresets() {
  if (_presets) return;
  try { _presets = await api('GET', '/presets'); } catch { _presets = { caption: {} }; }
}

function _presetOptions(selected, presets) {
  return Object.entries(presets).map(([k, p]) =>
    `<option value="${k}"${(selected ? selected === k : p.is_default) ? ' selected' : ''}>${p.label}</option>`
  ).join('');
}

function getLocalBounds(cid) {
  return _nudge[cid] || null;
}

function nudge(btn, jobId) {
  const cid = btn.dataset.cid;
  const field = btn.dataset.field;
  const delta = parseFloat(btn.dataset.delta);

  // Grab current displayed value as base
  const startEl = document.getElementById(`start-${cid}`);
  const endEl   = document.getElementById(`end-${cid}`);

  if (!_nudge[cid]) {
    // Parse currently displayed MM:SS values back to seconds
    _nudge[cid] = {
      start: mmssToSecs(startEl.textContent),
      end:   mmssToSecs(endEl.textContent),
    };
  }

  _nudge[cid][field] = Math.max(0, _nudge[cid][field] + delta);

  startEl.textContent = fmtSecs(_nudge[cid].start);
  endEl.textContent   = fmtSecs(_nudge[cid].end);
}

function mmssToSecs(s) {
  const [m, sec] = s.split(':').map(Number);
  return m * 60 + sec;
}

async function triggerRecut(cid, jobId) {
  const bounds    = _nudge[cid];
  const hasBounds = !!bounds;
  const hasPreset = !!_presetDirty[cid];

  try {
    if (hasBounds) {
      // Boundary changed — full recut; picks up any preset change from DB too.
      await api('PUT', `/candidates/${cid}/boundaries`, { start: bounds.start, end: bounds.end });
      toast('Recut queued…');
    } else if (hasPreset) {
      // Preset-only change — re-run caption + hook + assemble, skip cut/transcribe.
      await api('POST', `/candidates/${cid}/restyle`);
      toast('Re-styling queued…');
    } else {
      // No local changes — force a full recut with current boundaries.
      const startEl = document.getElementById(`start-${cid}`);
      const endEl   = document.getElementById(`end-${cid}`);
      await api('PUT', `/candidates/${cid}/boundaries`, {
        start: mmssToSecs(startEl.textContent),
        end:   mmssToSecs(endEl.textContent),
      });
      toast('Recut queued…');
    }
    delete _nudge[cid];
    delete _bsugg[cid];
    delete _presetDirty[cid];
    _restartDetailPoll();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function setApproval(cid, approve, jobId) {
  try {
    if (approve) {
      await api('POST', `/candidates/${cid}/approve`);
      toast('Clip approved', 'success');
    } else {
      await api('POST', `/candidates/${cid}/reject`);
      toast('Clip rejected');
    }
    await renderJobDetail(jobId);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function retryJob(jobId) {
  try {
    await api('POST', `/jobs/${jobId}/retry`);
    _restartDetailPoll();
    toast('Job re-queued…');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function publishJob(jobId) {
  try {
    const res = await api('POST', `/jobs/${jobId}/publish`);
    const ok  = res.results.filter(r => r.url).length;
    const bad = res.results.filter(r => r.error).length;
    if (ok)  toast(`${ok} clip(s) uploaded!`, 'success');
    if (bad) toast(`${bad} upload(s) failed`, 'error');
    await renderJobDetail(jobId);
  } catch (e) {
    toast('Publish error: ' + e.message, 'error');
  }
}

// ── Boundary suggestion (Layer 1) ─────────────────────────────────────────

function renderBsuggHtml(cid, sugg, cStart, cEnd) {
  if (!sugg) return '';
  const hasSuggStart = sugg.suggested_start != null;
  const hasSuggEnd   = sugg.suggested_end   != null;
  if (!hasSuggStart && !hasSuggEnd) return '';

  let items = '';
  if (hasSuggStart) {
    items += `
      <div class="bsugg-item">
        <div class="bsugg-reason">${sugg.reason_start}</div>
        <button class="btn btn-ghost btn-sm"
                onclick="acceptBsuggStart('${cid}', ${sugg.suggested_start}, ${cEnd})">Accept</button>
      </div>`;
  }
  if (hasSuggEnd) {
    items += `
      <div class="bsugg-item">
        <div class="bsugg-reason">${sugg.reason_end}</div>
        <button class="btn btn-ghost btn-sm"
                onclick="acceptBsuggEnd('${cid}', ${sugg.suggested_end}, ${cStart})">Accept</button>
      </div>`;
  }
  return `<div class="bsugg"><div class="bsugg-title">Sentence boundary suggestion</div>${items}</div>`;
}

async function fetchBsugg(cid, cStart, cEnd) {
  try {
    const sugg = await api('GET', `/candidates/${cid}/boundary-suggestion`);
    const has  = sugg.suggested_start != null || sugg.suggested_end != null;
    _bsugg[cid] = has ? sugg : null;
  } catch {
    _bsugg[cid] = null;
  }
  const el = document.getElementById(`bsugg-${cid}`);
  if (el) el.innerHTML = renderBsuggHtml(cid, _bsugg[cid], cStart, cEnd);
}

async function acceptBsuggStart(cid, suggestedStart, currentEnd) {
  try {
    await api('PUT', `/candidates/${cid}/boundaries`, { start: suggestedStart, end: currentEnd });
    delete _nudge[cid];
    delete _bsugg[cid];
    _restartDetailPoll();
    toast('Start shifted to sentence boundary, recut queued…');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function acceptBsuggEnd(cid, suggestedEnd, currentStart) {
  try {
    await api('PUT', `/candidates/${cid}/boundaries`, { start: currentStart, end: suggestedEnd });
    delete _nudge[cid];
    delete _bsugg[cid];
    _restartDetailPoll();
    toast('End shifted to sentence boundary, recut queued…');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ── History page ───────────────────────────────────────────────────────────

async function showHistory() {
  clearTimeout(_listPoll);
  _listPoll = null;
  clearTimeout(_detailPoll);
  _detailPoll = null;
  _currentJobId = null;
  Object.keys(_bsugg).forEach(k => delete _bsugg[k]);

  breadcrumb.innerHTML = '';

  app.innerHTML = `
    <div class="section-header">
      <h2>History</h2>
    </div>
    <div class="filter-bar">
      <select id="hist-source" class="filter-select">
        <option value="">All sources</option>
      </select>
      <select id="hist-status" class="filter-select">
        <option value="">All statuses</option>
        <option value="ready">Ready</option>
        <option value="approved">Approved</option>
        <option value="uploaded">Uploaded</option>
        <option value="failed">Failed</option>
        <option value="rejected">Rejected</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="hist-clear">Clear filters</button>
    </div>
    <div id="hist-list"><div class="loading">Loading…</div></div>
  `;

  try {
    const sources = await api('GET', '/history/sources');
    const sel = $('#hist-source');
    sources.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s.length > 60 ? s.slice(0, 60) + '…' : s;
      sel.appendChild(opt);
    });
  } catch {}

  const apply = () => renderHistoryList();
  $('#hist-source').onchange = apply;
  $('#hist-status').onchange = apply;
  $('#hist-clear').onclick = () => {
    $('#hist-source').value = '';
    $('#hist-status').value = '';
    apply();
  };

  await renderHistoryList();
}

async function renderHistoryList() {
  const wrap = $('#hist-list');
  if (!wrap) return;

  const source = $('#hist-source')?.value || '';
  const status = $('#hist-status')?.value || '';

  const qs = new URLSearchParams();
  if (source) qs.set('source_url', source);
  if (status) qs.set('status', status);

  try {
    const res = await fetch('/api/history' + (qs.toString() ? '?' + qs : ''));
    if (!res.ok) throw new Error(res.statusText);
    const clips = await res.json();

    if (!clips.length) {
      wrap.innerHTML = '<div class="empty">No clips found.</div>';
      return;
    }

    wrap.innerHTML = `
      <div class="hist-list-inner">
        ${clips.map(c => `
          <div class="hist-card" onclick="location.hash='job/${c.job_id}'" title="Open job">
            <div class="hist-card-main">
              <div class="hist-title">${c.title}</div>
              <div class="hist-source" title="${c.source_url}">${c.source_url.length > 65 ? c.source_url.slice(0, 65) + '…' : c.source_url}</div>
            </div>
            <div class="hist-card-side">
              <div class="hist-meta">${fmtDate(c.job_created_at)} · ${fmtDuration(c.end - c.start)}</div>
              <div style="display:flex;align-items:center;gap:8px">
                ${badge(c.approved ? 'approved' : c.status)}
                ${c.youtube_url ? `<a href="${c.youtube_url}" target="_blank" class="btn btn-ghost btn-sm" onclick="event.stopPropagation()">▶ YouTube</a>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}
