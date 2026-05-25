// ── Utilities ──────────────────────────────────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const app = document.getElementById('app');

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

function fmtAge(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Generates a status pill. Replaces the old badge() function — all call sites
// use the same function name so existing code is unchanged.
function badge(status) {
  const label = status.replace(/_/g, ' ');
  return `<span class="pill pill-${status}"><span class="pill-dot"></span>${label}</span>`;
}

// ── Sidebar helpers ────────────────────────────────────────────────────────

function setSidebarNav(active) {
  $$('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === active);
  });
}

function updateWorkerStatus(jobs) {
  const busy = jobs.some(j => ACTIVE_STATES.has(j.status));
  const dot  = document.getElementById('worker-dot');
  const text = document.getElementById('worker-text');
  if (dot)  dot.classList.toggle('busy', busy);
  if (text) text.textContent = `worker · ${busy ? 'running' : 'idle'}`;
  const countEl = document.getElementById('nav-jobs-count');
  if (countEl) countEl.textContent = jobs.length || '';
}

async function updateDiskStatus() {
  try {
    const { disk_free_gb, disk_total_gb } = await api('GET', '/system');
    const el = document.getElementById('disk-status');
    if (el) el.textContent = `disk · ${disk_free_gb} GB free`;
  } catch (_) { /* silently ignore if unavailable */ }
}

// ── Router ─────────────────────────────────────────────────────────────────

function route() {
  const hash = location.hash.slice(1);
  if (hash === 'history') {
    showHistory();
  } else if (hash === 'compose') {
    showComposeList();
  } else if (hash.startsWith('compose/')) {
    showComposeEditor(hash.slice(8));
  } else if (hash.startsWith('job/')) {
    showJobDetail(hash.slice(4));
  } else {
    showJobList();
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('load', () => { route(); updateDiskStatus(); });

// ── Job List ───────────────────────────────────────────────────────────────

let _listPoll;

const ACTIVE_STATES = new Set([
  'pending','downloading','cutting','transcribing',
  'captioning','creating_hook','assembling','delivering',
]);

async function showJobList() {
  clearTimeout(_listPoll);
  _listPoll = null;
  setSidebarNav('jobs');

  app.innerHTML = `
    <div class="screen-header" style="flex-shrink:0">
      <div class="screen-header-row">
        <div>
          <h1 class="screen-title">Jobs</h1>
          <div class="screen-subtitle">Running + queued batches. Open one when it's ready.</div>
        </div>
        <button class="btn btn-primary" id="btn-new">+ New Job</button>
      </div>
    </div>
    <div class="job-table-header" id="job-table-header" style="display:none">
      <div>Source</div><div>Status</div><div>Clips</div><div>Age</div><div></div>
    </div>
    <div class="screen-body" id="job-list-wrap">
      <div class="loading">Loading jobs…</div>
    </div>
  `;

  $('#btn-new').onclick = openNewJobModal;
  await renderJobList();
}

// ── New Job Modal ──────────────────────────────────────────────────────────

let _newJobModalEl = null;

function openNewJobModal() {
  if (_newJobModalEl) return;

  _formClips = [];
  Object.keys(_formHookFiles).forEach(k => delete _formHookFiles[k]);

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-new-job" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span class="modal-title">New Job</span>
        <button class="modal-close btn btn-ghost btn-sm" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-tabs">
          <button class="form-tab-btn active" id="tab-form" type="button">Form</button>
          <button class="form-tab-btn" id="tab-yaml" type="button">Upload YAML</button>
        </div>
        <div id="tab-content-form">
          <div class="form-grid">
            <div class="form-field">
              <label class="form-label" for="form-source-url">Source URL</label>
              <input class="form-input" id="form-source-url" type="url"
                     placeholder="https://youtube.com/watch?v=…" autocomplete="off" />
            </div>
            <div class="form-field">
              <label class="form-label" for="form-channel-name">Channel name</label>
              <input class="form-input" id="form-channel-name" type="text"
                     placeholder="Optional — shown as branding overlay" autocomplete="off" />
            </div>
            <div class="form-checkbox-group">
              <label class="form-checkbox-row">
                <input type="checkbox" id="form-captions" checked />
                <span>Default captions on</span>
              </label>
              <label class="form-checkbox-row">
                <input type="checkbox" id="form-hook" checked />
                <span>Default hook on</span>
              </label>
            </div>
            <div class="form-field" style="max-width:180px">
              <label class="form-label" for="form-hook-duration">Hook duration (s)</label>
              <input class="form-input form-input-sm" id="form-hook-duration" type="number"
                     min="1" max="10" step="0.5" value="3" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px">
              <div class="form-field">
                <label class="form-label" for="form-caption-preset">Caption style</label>
                <select class="form-input" id="form-caption-preset">
                  <option value="">Config default</option>
                </select>
              </div>
              <div class="form-field">
                <label class="form-label" for="form-hook-preset">Hook style</label>
                <select class="form-input" id="form-hook-preset">
                  <option value="">Config default</option>
                </select>
              </div>
            </div>
          </div>
          <div class="form-clips-header">
            <span class="form-clips-title">Clips</span>
            <button class="btn btn-ghost btn-sm" id="btn-add-clip" type="button">+ Add Clip</button>
          </div>
          <div class="form-clips-list" id="form-clips-list"></div>
          <div class="form-actions">
            <button class="btn btn-ghost btn-sm" id="btn-cancel-form" type="button">Cancel</button>
            <button class="btn btn-primary btn-sm" id="btn-form-submit" type="button">Process</button>
          </div>
        </div>
        <div id="tab-content-yaml" style="display:none">
          <div class="upload-area" id="drop-zone">
            <input type="file" id="yaml-input" accept=".yaml,.yml" />
            <div style="font-size:22px;margin-bottom:4px">📄</div>
            <strong style="font-size:13px">Drop your clips YAML here</strong>
            <p>or click to browse</p>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-ghost btn-sm" id="btn-cancel-upload">Cancel</button>
            <button class="btn btn-primary btn-sm" id="btn-submit-upload" disabled>Upload &amp; Process</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(el);
  _newJobModalEl = el;

  document.getElementById('modal-close-btn').onclick = closeNewJobModal;

  setupNewJobPanel();
}

function closeNewJobModal() {
  if (_newJobModalEl) { _newJobModalEl.remove(); _newJobModalEl = null; }
}

function setupUpload() {
  const dropZone  = $('#drop-zone');
  const fileInput = $('#yaml-input');
  const submitBtn = $('#btn-submit-upload');
  let selectedFile = null;

  dropZone.onclick = () => fileInput.click();
  fileInput.onchange = () => selectFile(fileInput.files[0]);

  dropZone.ondragover  = (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); };
  dropZone.ondragleave = ()  => dropZone.classList.remove('drag-over');
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
      closeNewJobModal();
      location.hash = 'job/' + job_id;
    } catch (e) {
      toast('Error: ' + e.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload & Process';
    }
  };
}

// ── Form-based job creation ────────────────────────────────────────────────

let _formClips = [];
let _formHookFiles = {}; // clip index → File

function escAttr(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function setupNewJobPanel() {
  $('#tab-form').onclick = () => {
    $('#tab-form').classList.add('active');
    $('#tab-yaml').classList.remove('active');
    $('#tab-content-form').style.display = '';
    $('#tab-content-yaml').style.display = 'none';
  };
  $('#tab-yaml').onclick = () => {
    $('#tab-yaml').classList.add('active');
    $('#tab-form').classList.remove('active');
    $('#tab-content-yaml').style.display = '';
    $('#tab-content-form').style.display = 'none';
  };

  $('#btn-cancel-form').onclick  = closeNewJobModal;
  $('#btn-cancel-upload').onclick = closeNewJobModal;
  $('#btn-add-clip').onclick      = () => {
    _formClips.push({ start: '', end: '', title: '', hook_text: '', hook_background: 'blur_self', caption_preset: '', hook_preset: '', hook_duration: '', hook_broll_start: '', hook_broll_end: '' });
    renderFormClips();
  };
  $('#btn-form-submit').onclick = submitForm;

  await loadPresets();
  const cp = _presets?.caption || {};
  const hp = _presets?.hook    || {};
  const captionEl = $('#form-caption-preset');
  if (captionEl) captionEl.innerHTML = _formPresetOptions('', cp, 'Config default');
  const hookEl = $('#form-hook-preset');
  if (hookEl) hookEl.innerHTML = _formPresetOptions('', hp, 'Config default');

  renderFormClips();
  setupUpload();
}

function renderFormClips() {
  const container = document.getElementById('form-clips-list');
  if (!container) return;

  if (!_formClips.length) {
    container.innerHTML = '<div class="form-clip-empty">No clips yet — click "+ Add Clip" to start.</div>';
    return;
  }

  container.innerHTML = _formClips.map((clip, i) => `
    <div class="form-clip-row">
      <div class="form-clip-header">
        <span class="form-clip-num">#${i + 1}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-remove-clip="${i}">✕</button>
      </div>
      <div class="form-clip-grid">
        <div class="form-field">
          <label class="form-label">Start</label>
          <input class="form-input form-input-sm" type="text"
                 data-clip-idx="${i}" data-clip-field="start"
                 value="${escAttr(clip.start)}" placeholder="MM:SS" />
        </div>
        <div class="form-field">
          <label class="form-label">End</label>
          <input class="form-input form-input-sm" type="text"
                 data-clip-idx="${i}" data-clip-field="end"
                 value="${escAttr(clip.end)}" placeholder="MM:SS" />
        </div>
        <div class="form-field form-field-span">
          <label class="form-label">Title</label>
          <input class="form-input" type="text"
                 data-clip-idx="${i}" data-clip-field="title"
                 value="${escAttr(clip.title)}" placeholder="Clip title" />
        </div>
        <div class="form-field form-field-span">
          <label class="form-label">Hook text</label>
          <input class="form-input" type="text"
                 data-clip-idx="${i}" data-clip-field="hook_text"
                 value="${escAttr(clip.hook_text)}" placeholder="Optional — use [word] to highlight" />
        </div>
        <div class="form-field form-field-span" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px">
          <div class="form-field">
            <label class="form-label">Caption style</label>
            <select class="form-input" data-clip-idx="${i}" data-clip-field="caption_preset">
              ${_formPresetOptions(clip.caption_preset, _presets?.caption || {}, 'Batch default')}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">Hook style</label>
            <select class="form-input" data-clip-idx="${i}" data-clip-field="hook_preset">
              ${_formPresetOptions(clip.hook_preset, _presets?.hook || {}, 'Batch default')}
            </select>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label">Hook source</label>
          <select class="form-input form-input-sm" data-clip-idx="${i}" data-clip-field="hook_background">
            <option value="blur_self"${clip.hook_background !== 'external' ? ' selected' : ''}>Generated (blur)</option>
            <option value="external"${clip.hook_background === 'external' ? ' selected' : ''}>Upload file</option>
          </select>
        </div>
        <div class="form-field" id="form-hook-file-row-${i}"${clip.hook_background !== 'external' ? ' style="display:none"' : ''}>
          <label class="form-label">Hook background (video or image)</label>
          <input type="file" accept="video/*,image/*" class="form-input form-input-sm"
                 data-clip-hook-file="${i}"
                 style="padding:4px 6px;cursor:pointer" />
          ${_formHookFiles[i] ? `<span style="font-size:10px;color:var(--text-muted);margin-top:2px">${escAttr(_formHookFiles[i].name)}</span>` : ''}
        </div>
        <div class="form-field">
          <label class="form-label">Hook duration (s)</label>
          <input class="form-input form-input-sm" type="number" min="1" max="10" step="0.5"
                 data-clip-idx="${i}" data-clip-field="hook_duration"
                 value="${clip.hook_duration || ''}" placeholder="Batch default" />
        </div>
        <div class="form-field" id="form-broll-start-row-${i}"${clip.hook_background === 'external' ? ' style="display:none"' : ''}>
          <label class="form-label">B-roll start <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
          <input class="form-input form-input-sm" type="text"
                 data-clip-idx="${i}" data-clip-field="hook_broll_start"
                 value="${escAttr(clip.hook_broll_start)}" placeholder="HH:MM:SS.mmm" />
        </div>
        <div class="form-field" id="form-broll-end-row-${i}"${clip.hook_background === 'external' ? ' style="display:none"' : ''}>
          <label class="form-label">B-roll end <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
          <input class="form-input form-input-sm" type="text"
                 data-clip-idx="${i}" data-clip-field="hook_broll_end"
                 value="${escAttr(clip.hook_broll_end)}" placeholder="HH:MM:SS.mmm" />
        </div>
      </div>
    </div>
  `).join('');

  $$('[data-clip-idx]', container).forEach(inp => {
    const idx = () => +inp.dataset.clipIdx;
    if (inp.tagName === 'SELECT') {
      inp.onchange = () => {
        _formClips[idx()][inp.dataset.clipField] = inp.value;
        if (inp.dataset.clipField === 'hook_background') {
          const fileRow   = document.getElementById(`form-hook-file-row-${idx()}`);
          const brollStartRow = document.getElementById(`form-broll-start-row-${idx()}`);
          const brollEndRow   = document.getElementById(`form-broll-end-row-${idx()}`);
          const isExternal = inp.value === 'external';
          if (fileRow)       fileRow.style.display       = isExternal ? '' : 'none';
          if (brollStartRow) brollStartRow.style.display = isExternal ? 'none' : '';
          if (brollEndRow)   brollEndRow.style.display   = isExternal ? 'none' : '';
        }
      };
    } else {
      inp.oninput = () => {
        _formClips[idx()][inp.dataset.clipField] = inp.value;
      };
    }
  });

  $$('[data-clip-hook-file]', container).forEach(inp => {
    inp.onchange = () => {
      const idx = +inp.dataset.clipHookFile;
      _formHookFiles[idx] = inp.files[0] || null;
    };
  });

  $$('[data-remove-clip]', container).forEach(btn => {
    btn.onclick = () => {
      const idx = +btn.dataset.removeClip;
      delete _formHookFiles[idx];
      _formClips.splice(idx, 1);
      // Re-index _formHookFiles after splice
      const reindexed = {};
      Object.keys(_formHookFiles).forEach(k => {
        const n = +k;
        if (n > idx) reindexed[n - 1] = _formHookFiles[k];
        else if (n < idx) reindexed[n] = _formHookFiles[k];
      });
      Object.keys(_formHookFiles).forEach(k => delete _formHookFiles[k]);
      Object.assign(_formHookFiles, reindexed);
      renderFormClips();
    };
  });
}

async function submitForm() {
  const sourceUrl   = $('#form-source-url')?.value.trim();
  const channelName = $('#form-channel-name')?.value.trim();
  const defCaptions = $('#form-captions')?.checked ?? true;
  const hookEnabled = $('#form-hook')?.checked ?? true;

  if (!sourceUrl)       { toast('Source URL is required', 'error'); return; }
  if (!_formClips.length) { toast('Add at least one clip', 'error'); return; }

  for (let i = 0; i < _formClips.length; i++) {
    const c = _formClips[i];
    if (!c.start?.trim() || !c.end?.trim() || !c.title?.trim()) {
      toast(`Clip #${i + 1}: start, end, and title are required`, 'error');
      return;
    }
  }

  const btn = $('#btn-form-submit');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  const defaultCaptionPreset = $('#form-caption-preset')?.value || null;
  const defaultHookPreset    = $('#form-hook-preset')?.value    || null;
  const hookDuration         = parseFloat($('#form-hook-duration')?.value) || 3;

  try {
    const { job_id } = await api('POST', '/jobs/from-form', {
      source_url:             sourceUrl,
      channel_name:           channelName || null,
      default_captions:       defCaptions,
      hook_enabled:           hookEnabled,
      hook_duration:          hookDuration,
      default_caption_preset: defaultCaptionPreset,
      default_hook_preset:    defaultHookPreset,
      clips: _formClips.map(c => ({
        start:          c.start.trim(),
        end:            c.end.trim(),
        title:          c.title.trim(),
        hook_text:        c.hook_text?.trim() || null,
        caption_preset:   c.caption_preset || null,
        hook_preset:      c.hook_preset    || null,
        hook_duration:    c.hook_duration ? parseFloat(c.hook_duration) : null,
        hook_broll_start: c.hook_broll_start?.trim() || null,
        hook_broll_end:   c.hook_broll_end?.trim()   || null,
      })),
    });

    // Upload staged hook files for clips that selected "upload file"
    const hookUploads = Object.entries(_formHookFiles).filter(([, f]) => f);
    if (hookUploads.length) {
      btn.textContent = 'Uploading hook files…';
      await Promise.all(hookUploads.map(async ([idx, file]) => {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`/api/jobs/${job_id}/hook-videos/${idx}`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`Hook file ${+idx + 1} upload failed`);
      }));
    }

    toast('Job created! Processing…', 'success');
    _formClips = [];
    Object.keys(_formHookFiles).forEach(k => delete _formHookFiles[k]);
    closeNewJobModal();
    location.hash = 'job/' + job_id;
  } catch (e) {
    toast('Error: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Process';
  }
}

async function renderJobList() {
  const wrap = document.getElementById('job-list-wrap');
  if (!wrap) return;
  try {
    const jobs = await api('GET', '/jobs');
    updateWorkerStatus(jobs);
    updateDiskStatus();

    if (!jobs.length) {
      const hdr = document.getElementById('job-table-header');
      if (hdr) hdr.style.display = 'none';
      wrap.innerHTML = '<div class="empty">No jobs yet. Create one with "+ New Job".</div>';
      return;
    }

    const hdr = document.getElementById('job-table-header');
    if (hdr) hdr.style.display = '';

    wrap.innerHTML = jobs.map(j => {
      const isActive = ACTIVE_STATES.has(j.status);
      const clipCount = j.clip_count ?? 0;
      const approvedCount = j.approved_count ?? 0;

      let outputCell;
      if (isActive) {
        outputCell = `
          <div>
            <div class="progress-mini-label">${clipCount} clip${clipCount !== 1 ? 's' : ''}</div>
            <div class="progress-mini-bar">
              <div class="progress-mini-fill" style="width:${clipCount ? Math.round((approvedCount/clipCount)*100) : 0}%"></div>
            </div>
          </div>`;
      } else {
        outputCell = `<div class="job-row-meta">${approvedCount} of ${clipCount} approved</div>`;
      }

      const url = j.source_url || '';
      const meta = JSON.parse(j.metadata_json || '{}');
      const videoTitle = meta.title || null;
      const channelName = meta.uploader || j.channel_name || null;
      const shortUrl = url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 52);
      const displayTitle = videoTitle
        ? (channelName ? `[${channelName}] ${videoTitle}` : videoTitle)
        : (channelName ? `[${channelName}] ${shortUrl}` : shortUrl);
      const titleAttr = videoTitle ? `${channelName ? `[${channelName}] ` : ''}${videoTitle}` : url;

      return `
        <div class="job-row" onclick="location.hash='job/${j.id}'">
          <div>
            <div class="job-row-title" title="${titleAttr}">${displayTitle}</div>
            <div class="job-row-sub">${fmtDate(j.created_at)}</div>
          </div>
          <div>${badge(j.status)}</div>
          ${outputCell}
          <div class="job-row-age">${fmtAge(j.created_at)}</div>
          <div class="job-row-chevron">›</div>
        </div>`;
    }).join('');

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
let _activeClipId = null;
let _jobCache     = null;

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
  _detailPoll   = null;
  _currentJobId = jobId;
  _activeClipId = null;
  _jobCache     = null;
  Object.keys(_bsugg).forEach(k => delete _bsugg[k]);
  Object.keys(_presetDirty).forEach(k => delete _presetDirty[k]);
  Object.keys(_txWords).forEach(k => delete _txWords[k]);
  Object.keys(_txHasEdits).forEach(k => delete _txHasEdits[k]);
  Object.keys(_txDirty).forEach(k => delete _txDirty[k]);
  Object.keys(_txFetching).forEach(k => delete _txFetching[k]);
  Object.keys(_hookTextEdits).forEach(k => delete _hookTextEdits[k]);
  setSidebarNav('jobs');

  app.innerHTML = `
    <div class="detail-header">
      <button class="detail-header-back" onclick="location.hash=''">← Jobs</button>
      <div class="detail-header-divider"></div>
      <div class="detail-header-main">
        <div class="detail-header-title">Loading…</div>
      </div>
    </div>
    <div style="flex:1;display:flex;align-items:center;justify-content:center">
      <div class="loading">Loading job…</div>
    </div>
  `;

  await renderJobDetail(jobId);
}

async function renderJobDetail(jobId, { force = false } = {}) {
  if (!force && $$('video').some(v => v.currentTime > 0 && !v.ended)) {
    _scheduleDetailPoll(jobId);
    return;
  }

  try {
    await loadPresets();
    const job = await api('GET', `/jobs/${jobId}`);
    _jobCache = job;

    const jobActive   = ACTIVE_STATES.has(job.status);
    const candsActive = job.candidates?.some(c => ACTIVE_STATES.has(c.status)) ?? false;
    clearTimeout(_detailPoll);
    _detailPoll = null;
    if (jobActive || candsActive) _scheduleDetailPoll(jobId);

    const meta          = JSON.parse(job.metadata_json || '{}');
    const title         = meta.title || job.source_url;
    const channelName   = meta.uploader || job.channel_name || null;
    const approvedCount = job.candidates?.filter(c => c.approved).length ?? 0;
    const totalCount    = job.candidates?.length ?? 0;
    const hasApproved   = job.candidates?.some(c => c.approved && c.status === 'ready');

    // Determine active clip — preserve selection across polls; default to first unreviewed
    if (!_activeClipId || !job.candidates?.find(c => c.id === _activeClipId)) {
      const firstPending = job.candidates?.find(c => !c.approved && c.status !== 'rejected');
      _activeClipId = firstPending?.id || job.candidates?.[0]?.id || null;
    }
    const activeClip = job.candidates?.find(c => c.id === _activeClipId) || null;
    const activeIdx  = job.candidates?.findIndex(c => c.id === _activeClipId) ?? -1;

    app.innerHTML = `
      <div class="detail-header" style="flex-shrink:0">
        <button class="detail-header-back" onclick="location.hash=''">← Jobs</button>
        <div class="detail-header-divider"></div>
        <div class="detail-header-main">
          <div class="detail-header-title" title="${escAttr(title)}">${title.length > 70 ? title.slice(0, 70) + '…' : title}</div>
          <div class="detail-header-meta">${channelName ? channelName + ' · ' : ''}${fmtDate(job.created_at)} · ${totalCount} clip${totalCount !== 1 ? 's' : ''}</div>
        </div>
        ${badge(job.status)}
        <div class="detail-header-stats" style="${totalCount ? '' : 'display:none'}">
          <div>${approvedCount} of ${totalCount} reviewed</div>
          <div class="detail-header-approved">${approvedCount} approved</div>
        </div>
        ${hasApproved ? `
          <div class="deliver-group" id="deliver-group">
            <select class="deliver-select" id="deliver-select"></select>
            <button class="btn btn-primary btn-sm" id="btn-deliver">↑ Deliver ${approvedCount}</button>
          </div>` : ''}
        ${job.status === 'failed' ? `<button class="btn btn-ghost btn-sm" id="btn-retry">↺ Retry</button>` : ''}
        ${job.error ? `<div style="color:var(--red);font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(job.error)}">${job.error.split('\n')[0]}</div>` : ''}
      </div>
      ${job.status === 'downloading' ? renderDownloadProgress(job.download_progress) : ''}
      <div class="review-body">
        <aside class="clip-list-panel">
          <div class="clip-list-panel-header">
            <span style="font-size:12px;font-weight:600">Clips</span>
            <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim)">${totalCount}</span>
          </div>
          <div class="clip-list-panel-scroll">
            ${(job.candidates || []).map((c, i) => renderClipListItem(c, i, c.id === _activeClipId)).join('')}
            ${!job.candidates?.length ? '<div style="padding:14px;font-size:12px;color:var(--text-dim);text-align:center">Processing…</div>' : ''}
          </div>
        </aside>
        <section class="clip-center-panel" id="clip-center">
          ${renderClipCenterHtml(activeClip, activeIdx, totalCount)}
        </section>
        <aside class="clip-controls-panel" id="clip-controls">
          ${activeClip
            ? renderClipControlsHtml(activeClip)
            : '<div style="padding:20px;color:var(--text-dim);font-size:12px">Select a clip to review</div>'}
        </aside>
      </div>
    `;

    if (hasApproved) {
      populateDelivererSelect();
      document.getElementById('btn-deliver').onclick = () => {
        const sel = document.getElementById('deliver-select');
        deliverJob(jobId, sel?.value || null);
      };
    }
    const retryBtn = document.getElementById('btn-retry');
    if (retryBtn) retryBtn.onclick = () => retryJob(jobId);

    $$('.clip-list-item').forEach(el => {
      el.onclick = () => {
        $$('video').forEach(v => v.pause());
        _activeClipId = el.dataset.cid;
        renderJobDetail(_currentJobId, { force: true });
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
    $$('[data-nudge]').forEach(btn => {
      btn.onclick = () => nudge(btn, jobId);
    });
    $$('[data-preset-type]').forEach(sel => {
      sel.onchange = () => changePreset(sel.dataset.cid, sel.dataset.presetType, sel.value, jobId);
    });
    $$('[data-hook-src]').forEach(btn => {
      btn.onclick = () => toggleHookSource(btn.dataset.cid, btn.dataset.hookSrc);
    });
    $$('[data-hook-pick]').forEach(btn => {
      btn.onclick = () => document.getElementById(`hook-file-${btn.dataset.hookPick}`)?.click();
    });
    $$('input[id^="hook-file-"]').forEach(inp => {
      inp.onchange = () => {
        const cid       = inp.id.replace('hook-file-', '');
        const file      = inp.files[0];
        const nameEl    = document.getElementById(`hook-fname-${cid}`);
        const uploadBtn = inp.parentElement?.querySelector('[data-hook-upload]');
        if (nameEl)    nameEl.textContent = file ? file.name : '';
        if (uploadBtn) uploadBtn.style.display = file ? '' : 'none';
      };
    });
    $$('[data-hook-upload]').forEach(btn => {
      btn.onclick = () => uploadHookVideo(btn.dataset.hookUpload);
    });
    $$('[data-hook-remove]').forEach(btn => {
      btn.onclick = () => removeHookVideo(btn.dataset.hookRemove);
    });

    // Load transcript + boundary suggestion for the active clip
    if (activeClip) {
      const cid = activeClip.id;
      if (_bsugg[cid] === undefined) fetchBsugg(cid, activeClip.start, activeClip.end);
      if (activeClip.needs_caption) {
        if (_txWords[cid] !== undefined) {
          if (_txWords[cid].length > 0) {
            renderTranscriptWords(cid, _txWords[cid]);
            checkTxDirty(cid);
          }
          updateTxActions(cid);
        } else if (!_txFetching[cid]) {
          fetchTranscript(cid);
        }
      }
    }

    // Initialize hook text editing state and attach textarea handler
    if (activeClip && activeClip.hook_enabled) {
      const cid = activeClip.id;
      if (!_hookTextEdits[cid]) {
        _hookTextEdits[cid] = {
          original: activeClip.hook_text || '',
          current:  activeClip.hook_text || '',
        };
      }
      const ta = document.getElementById(`hook-text-${cid}`);
      if (ta) {
        ta.oninput = () => checkHookTextDirty(cid);
        checkHookTextDirty(cid);
      }
    }

  } catch (e) {
    app.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

function renderClipListItem(c, idx, isActive) {
  const dur = c.end - c.start;
  let dotColor = 'var(--text-dim)';
  if (c.approved)                       dotColor = 'var(--green)';
  else if (c.status === 'rejected')     dotColor = 'var(--red)';
  else if (c.status === 'failed')       dotColor = 'var(--red)';
  else if (c.status === 'ready')        dotColor = 'var(--accent)';
  else if (ACTIVE_STATES.has(c.status)) dotColor = 'var(--amber)';

  return `
    <div class="clip-list-item${isActive ? ' active' : ''}" data-cid="${c.id}">
      <div class="clip-list-thumb">
        <span style="font-size:9px;color:var(--text-dim);font-family:var(--font-mono)">${String(idx + 1).padStart(2, '0')}</span>
      </div>
      <div style="min-width:0;flex:1">
        <div class="clip-list-item-meta">
          <span class="clip-list-item-idx">${String(idx + 1).padStart(2, '0')}</span>
          <span style="width:6px;height:6px;border-radius:50%;background:${dotColor};flex-shrink:0;display:inline-block"></span>
          <span class="clip-list-item-dur">${fmtDuration(dur)}</span>
        </div>
        <div class="clip-list-item-title">${c.title}</div>
      </div>
    </div>`;
}

function renderClipCenterHtml(c, idx, total) {
  if (!c) return `<div class="empty" style="padding-top:80px">No clips yet — processing…</div>`;
  const dur      = c.end - c.start;
  const hasVideo = c.status === 'ready' || c.approved || c.status === 'delivered_local';
  return `
    <div class="clip-center-meta">
      <div class="clip-center-number">Clip ${String(idx + 1).padStart(2, '0')} of ${String(total).padStart(2, '0')}</div>
      <div class="clip-center-title">${c.title}</div>
      <div class="clip-center-timecodes">
        <span>${fmtSecs(c.start)} → ${fmtSecs(c.end)}</span>
        <span style="color:var(--border-strong)">·</span>
        <span>${fmtDuration(dur)}</span>
        <span style="color:var(--border-strong)">·</span>
        ${badge(c.approved ? 'approved' : c.status)}
      </div>
    </div>
    <div class="clip-center-video">
      ${hasVideo
        ? `<video controls src="/video/${c.id}?v=${encodeURIComponent((c.output_path||'').replace(/\\/g,'/').split('/').pop())}" preload="metadata"></video>
           <div class="clip-video-overlay-stub"></div>`
        : `<div class="clip-video-placeholder">${statusMsg(c)}</div>`
      }
    </div>
    ${hasVideo ? `<div class="clip-center-video-label">${previewLabel(c)}</div>` : ''}
    ${c.hook_text ? `<div style="margin-top:8px;font-size:11px;color:var(--text-muted);max-width:300px;width:100%">Hook: <em>${c.hook_text}</em></div>` : ''}
    ${c.delivery_url ? `<span style="margin-top:10px;font-size:10px;color:var(--text-muted)">✓ Delivered</span>` : ''}`;
}

function renderClipControlsHtml(c) {
  const hasVideo = c.status === 'ready' || c.approved || c.status === 'delivered_local';

  // Show nudge values preserved from any pending nudge state
  const dispStart = fmtSecs(_nudge[c.id]?.start ?? c.start);
  const dispEnd   = fmtSecs(_nudge[c.id]?.end   ?? c.end);

  const boundaryHtml = `
    <div class="ctrl-section">
      <span class="ctrl-section-title">Boundary</span>
      <div class="ctrl-nudge-row" style="border-bottom:1px solid var(--border)">
        <span class="ctrl-nudge-label">START</span>
        <span class="ctrl-nudge-val" id="start-${c.id}">${dispStart}</span>
        <div class="ctrl-nudge-btns">
          <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="start" data-delta="-5">−5s</button>
          <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="start" data-delta="-1">−1s</button>
          <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="start" data-delta="1">+1s</button>
          <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="start" data-delta="5">+5s</button>
        </div>
      </div>
      <div class="ctrl-nudge-row">
        <span class="ctrl-nudge-label">END</span>
        <span class="ctrl-nudge-val" id="end-${c.id}">${dispEnd}</span>
        <div class="ctrl-nudge-btns">
          <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="end" data-delta="-5">−5s</button>
          <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="end" data-delta="-1">−1s</button>
          <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="end" data-delta="1">+1s</button>
          <button class="btn btn-ghost btn-sm" data-nudge data-cid="${c.id}" data-field="end" data-delta="5">+5s</button>
        </div>
      </div>
    </div>`;

  const suggHtml = `<div class="ctrl-sugg-wrap" id="bsugg-${c.id}">${renderBsuggHtml(c.id, _bsugg[c.id], c.start, c.end)}</div>`;

  const cp = _presets?.caption || {};
  const hp = _presets?.hook    || {};
  const hasPresets = Object.keys(cp).length || Object.keys(hp).length;
  const presetsHtml = hasPresets && (c.needs_caption || (c.hook_enabled && c.hook_text)) ? `
    <div class="ctrl-section" style="border-top:1px solid var(--border)">
      <span class="ctrl-section-title">Style</span>
      <div class="preset-row">
        ${c.needs_caption ? `
          <div class="preset-field">
            <label class="preset-label">Caption</label>
            <select class="preset-select" data-preset-type="caption" data-cid="${c.id}">
              ${_presetOptions(c.caption_preset, cp)}
            </select>
          </div>` : ''}
        ${c.hook_enabled && c.hook_text ? `
          <div class="preset-field">
            <label class="preset-label">Hook style</label>
            <select class="preset-select" data-preset-type="hook" data-cid="${c.id}">
              ${_presetOptions(c.hook_preset || null, hp)}
            </select>
          </div>` : ''}
      </div>
    </div>` : '';

  const isExternal   = c.hook_background === 'external';
  const hookTextVal  = _hookTextEdits[c.id]?.current ?? (c.hook_text || '');
  const hookHtml = c.hook_enabled ? `
    <div class="ctrl-section" style="border-top:1px solid var(--border)">
      <span class="ctrl-section-title">Hook</span>
      <div style="margin-bottom:10px">
        <label class="preset-label" style="margin-bottom:4px;display:block">Text</label>
        <input id="hook-text-${c.id}" class="form-input" type="text"
               value="${escAttr(hookTextVal)}"
               placeholder="Use [word] for highlights…" style="width:100%;box-sizing:border-box" />
        <div id="hook-text-actions-${c.id}" style="margin-top:4px;display:flex;justify-content:flex-end"></div>
      </div>
      <label class="preset-label" style="margin-bottom:4px;display:block">Source</label>
      <div class="hook-source-toggle" style="margin-bottom:8px">
        <button class="hook-src-btn${!isExternal ? ' active' : ''}" data-hook-src="blur_self" data-cid="${c.id}">Generated (blur)</button>
        <button class="hook-src-btn${isExternal ? ' active' : ''}" data-hook-src="external" data-cid="${c.id}">Upload file</button>
      </div>
      <div id="hook-upload-${c.id}" style="${!isExternal ? 'display:none' : ''}">
        ${isExternal ? `
          <div class="hook-upload-status">
            <span style="color:var(--green);font-size:11px">✓ Custom background uploaded</span>
            <button class="btn btn-ghost btn-sm" data-hook-remove="${c.id}">Remove</button>
          </div>` : ''}
        <div class="hook-upload-input" id="hook-upload-input-${c.id}"${isExternal ? ' style="display:none"' : ''}>
          <input type="file" accept="video/*,image/*" id="hook-file-${c.id}" style="display:none" />
          <button class="btn btn-ghost btn-sm" data-hook-pick="${c.id}">Choose file…</button>
          <span id="hook-fname-${c.id}" style="font-size:10px;color:var(--text-muted)"></span>
          <button class="btn btn-primary btn-sm" data-hook-upload="${c.id}" style="display:none">Upload</button>
        </div>
      </div>
    </div>` : '';

  const txHtml = c.needs_caption ? `
    <div class="ctrl-section" style="border-top:1px solid var(--border)">
      <div class="tx-header" style="margin-bottom:6px">
        <span class="ctrl-section-title" style="margin-bottom:0">Transcript</span>
        <div class="tx-actions" id="tx-actions-${c.id}"></div>
      </div>
      <div class="tx-words" id="tx-words-${c.id}">
        ${hasVideo ? '<span class="tx-loading">Loading…</span>' : '<span class="tx-empty">Available after processing</span>'}
      </div>
      <button class="btn btn-yellow" style="margin-top:12px;width:100%;justify-content:center;padding:9px" data-recut="${c.id}">
        ↻ Regenerate
      </button>
    </div>` : `
    <div class="ctrl-section" style="border-top:1px solid var(--border)">
      <button class="btn btn-yellow" style="width:100%;justify-content:center;padding:9px" data-recut="${c.id}">
        ↻ Regenerate
      </button>
    </div>`;

  const errHtml = c.error ? `
    <div style="padding:0 20px 14px">
      <div class="clip-error">${c.error}</div>
    </div>` : '';

  const decisionHtml = `
    <div class="review-decision-bar">
      ${c.approved
        ? `<button class="btn btn-ghost btn-sm" data-reject="${c.id}" style="flex:0 0 auto;padding:9px 14px">✕ Unapprove</button>`
        : `<button class="btn btn-ghost-danger" data-reject="${c.id}" style="flex:0 0 auto;padding:9px 14px">✕ Reject</button>
           <button class="btn btn-green" data-approve="${c.id}" style="flex:1;padding:9px 14px;justify-content:center">✓ Approve clip</button>`
      }
    </div>`;

  return `
    <div class="clip-controls-scroll">
      ${boundaryHtml}
      ${suggHtml}
      ${presetsHtml}
      ${hookHtml}
      ${txHtml}
      ${errHtml}
    </div>
    ${decisionHtml}`;
}

function renderDownloadProgress(pct) {
  const p = (pct != null && pct >= 0) ? Math.min(pct, 100) : null;
  const label = p != null ? `${p}%` : 'Starting…';
  const width  = p != null ? p : 0;
  return `
    <div class="download-progress-bar" style="flex-shrink:0">
      <div class="download-progress-inner">
        <div class="download-progress-label">
          <span>Downloading source video</span>
          <span class="download-progress-pct">${label}</span>
        </div>
        <div class="download-progress-track">
          <div class="download-progress-fill" style="width:${width}%"></div>
        </div>
      </div>
    </div>`;
}


function statusMsg(c) {
  if (c.status === 'pending')    return 'Waiting…';
  if (c.status === 'cutting')    return 'Cutting…';
  if (c.status === 'failed')     return 'Failed';
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

// ── Hook video upload ─────────────────────────────────────────────────────

function toggleHookSource(cid, src) {
  const uploadArea = document.getElementById(`hook-upload-${cid}`);
  const btns = document.querySelectorAll(`[data-hook-src][data-cid="${cid}"]`);
  btns.forEach(b => b.classList.toggle('active', b.dataset.hookSrc === src));
  if (uploadArea) uploadArea.style.display = src === 'external' ? '' : 'none';
}

async function uploadHookVideo(cid) {
  const inp  = document.getElementById(`hook-file-${cid}`);
  const file = inp?.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(`/api/candidates/${cid}/hook-video`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
    toast('Hook video uploaded', 'success');
    _restartDetailPoll();
  } catch (e) {
    toast('Upload failed: ' + e.message, 'error');
  }
}

async function removeHookVideo(cid) {
  try {
    await api('DELETE', `/candidates/${cid}/hook-video`);
    toast('Hook video removed — using blur');
    _restartDetailPoll();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ── Hook text editing ─────────────────────────────────────────────────────

function checkHookTextDirty(cid) {
  const edit = _hookTextEdits[cid];
  if (!edit) return;
  const ta = document.getElementById(`hook-text-${cid}`);
  if (ta) edit.current = ta.value;
  const isDirty = edit.current !== edit.original;
  const actionsEl = document.getElementById(`hook-text-actions-${cid}`);
  if (actionsEl) {
    actionsEl.innerHTML = isDirty
      ? `<button class="btn btn-ghost btn-sm" onclick="saveHookText('${cid}')">Save</button>`
      : '';
  }
}

async function saveHookText(cid) {
  const edit = _hookTextEdits[cid];
  if (!edit) return;
  const ta   = document.getElementById(`hook-text-${cid}`);
  const text = (ta ? ta.value : edit.current).trim();
  try {
    await api('PUT', `/candidates/${cid}/hook-text`, { hook_text: text });
    edit.original     = text;
    edit.current      = text;
    _presetDirty[cid] = true;
    checkHookTextDirty(cid);
    toast('Hook text saved — click Regenerate to apply');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ── Nudge state ────────────────────────────────────────────────────────────

const _nudge        = {};  // cid -> { start, end }
const _bsugg        = {};  // cid -> suggestion object | null
const _presetDirty  = {};  // cid -> true when preset changed but not regenerated
const _hookTextEdits = {}; // cid -> { original: str, current: str }

// ── Transcript editor state ────────────────────────────────────────────────

const _txWords    = {};  // cid -> word array (baseline for change detection)
const _txHasEdits = {};  // cid -> bool (words_edited.json exists on backend)
const _txDirty    = {};  // cid -> bool (current cells differ from baseline)
const _txFetching = {};  // cid -> bool (fetch in progress)

// ── Preset cache ───────────────────────────────────────────────────────────

let _presets = null;

async function loadPresets() {
  if (_presets) return;
  try { _presets = await api('GET', '/presets'); } catch { _presets = { caption: {}, hook: {} }; }
}

function _presetOptions(selected, presets) {
  return Object.entries(presets).map(([k, p]) =>
    `<option value="${k}"${(selected ? selected === k : p.is_default) ? ' selected' : ''}>${p.label}</option>`
  ).join('');
}

// For form inputs: first option is "use default", then all presets.
function _formPresetOptions(selected, presets, defaultLabel) {
  const base = `<option value=""${!selected ? ' selected' : ''}>${defaultLabel}</option>`;
  return base + Object.entries(presets || {}).map(([k, p]) =>
    `<option value="${k}"${selected === k ? ' selected' : ''}>${p.label}</option>`
  ).join('');
}

function nudge(btn, jobId) {
  const cid   = btn.dataset.cid;
  const field = btn.dataset.field;
  const delta = parseFloat(btn.dataset.delta);

  const startEl = document.getElementById(`start-${cid}`);
  const endEl   = document.getElementById(`end-${cid}`);

  if (!_nudge[cid]) {
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
  const hasPreset = !!_presetDirty[cid] || !!_txHasEdits[cid];

  try {
    if (hasBounds) {
      await api('PUT', `/candidates/${cid}/boundaries`, { start: bounds.start, end: bounds.end });
      toast('Recut queued…');
    } else if (hasPreset) {
      await api('POST', `/candidates/${cid}/restyle`);
      toast('Re-styling queued…');
    } else {
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

// ── Deliverer selector ────────────────────────────────────────────────────

let _deliverers = null;

async function loadDeliverers() {
  if (_deliverers) return;
  try { _deliverers = await api('GET', '/deliverers'); } catch { _deliverers = { deliverers: [{id:'local',label:'Local folder'}], default: 'local' }; }
}

async function populateDelivererSelect() {
  await loadDeliverers();
  const sel = document.getElementById('deliver-select');
  if (!sel || !_deliverers) return;
  sel.innerHTML = _deliverers.deliverers.map(d =>
    `<option value="${d.id}"${d.id === _deliverers.default ? ' selected' : ''}>${d.label}</option>`
  ).join('');
}

async function deliverJob(jobId, delivererId) {
  try {
    const body = delivererId ? { deliverer: delivererId } : {};
    const res = await api('POST', `/jobs/${jobId}/deliver`, body);
    const ok  = res.results.filter(r => !r.error).length;
    const bad = res.results.filter(r => r.error).length;
    if (ok)  toast(`${ok} clip(s) delivered!`, 'success');
    if (bad) toast(`${bad} delivery failure(s)`, 'error');
    await renderJobDetail(jobId);
  } catch (e) {
    toast('Delivery error: ' + e.message, 'error');
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

// ── Transcript editor ─────────────────────────────────────────────────────

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchTranscript(cid) {
  _txFetching[cid] = true;
  const wordsEl = document.getElementById(`tx-words-${cid}`);
  if (wordsEl) wordsEl.innerHTML = '<span class="tx-loading">Loading…</span>';
  try {
    const data = await api('GET', `/candidates/${cid}/transcript`);
    _txWords[cid]    = data.words;
    _txHasEdits[cid] = data.has_edits;
    _txDirty[cid]    = false;
    if (!data.words.length) {
      const el = document.getElementById(`tx-words-${cid}`);
      if (el) el.innerHTML = '<span class="tx-empty">No transcript available</span>';
    } else {
      renderTranscriptWords(cid, data.words);
    }
    updateTxActions(cid);
  } catch {
    const el = document.getElementById(`tx-words-${cid}`);
    if (el) el.innerHTML = '<span class="tx-empty">Could not load transcript</span>';
  } finally {
    _txFetching[cid] = false;
  }
}

function renderTranscriptWords(cid, words) {
  const el = document.getElementById(`tx-words-${cid}`);
  if (!el) return;
  el.innerHTML = words.map((w, i) =>
    `<span class="tx-word" contenteditable="true" data-tx-cid="${cid}" data-tx-idx="${i}">${escHtml(w.text)}</span>`
  ).join('');
  attachTxHandlers(cid, el);
}

function attachTxHandlers(cid, container) {
  $$(`[data-tx-cid="${cid}"]`, container).forEach(span => {
    span.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
    });
    span.addEventListener('paste', e => {
      e.preventDefault();
      const raw  = e.clipboardData.getData('text/plain');
      const word = raw.split(/\s+/).filter(Boolean)[0] || '';
      document.execCommand('insertText', false, word);
    });
    span.addEventListener('input', () => {
      const text = span.textContent;
      if (text.includes(' ') || text.includes('\n')) {
        span.textContent = text.replace(/[\s\n]/g, '');
        const range = document.createRange();
        range.selectNodeContents(span);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      checkTxDirty(cid);
    });
  });
}

function checkTxDirty(cid) {
  const baseline = _txWords[cid];
  if (!baseline) return;
  const spans = $$(`[data-tx-cid="${cid}"]`);
  let dirty = false;
  spans.forEach((span, i) => {
    const changed = span.textContent !== (baseline[i]?.text || '');
    span.classList.toggle('tx-changed', changed);
    if (changed) dirty = true;
  });
  _txDirty[cid] = dirty;
  updateTxActions(cid);
}

function updateTxActions(cid) {
  const el = document.getElementById(`tx-actions-${cid}`);
  if (!el) return;
  let html = '';
  if (_txHasEdits[cid]) {
    html += '<span class="tx-edited-badge">edited</span>';
  }
  if (_txDirty[cid]) {
    html += `<button class="btn btn-ghost btn-sm" onclick="saveTxEdits('${cid}')">Save edits</button>`;
  }
  el.innerHTML = html;
}

async function saveTxEdits(cid) {
  const spans = $$(`[data-tx-cid="${cid}"]`);
  const words = spans.map(span => ({ text: span.textContent.trim() }));
  try {
    await api('PUT', `/candidates/${cid}/transcript`, { words });
    if (_txWords[cid]) {
      words.forEach((w, i) => { if (_txWords[cid][i]) _txWords[cid][i] = { ..._txWords[cid][i], text: w.text }; });
    }
    _txHasEdits[cid] = true;
    _txDirty[cid]    = false;
    $$(`[data-tx-cid="${cid}"]`).forEach(s => s.classList.remove('tx-changed'));
    updateTxActions(cid);
    toast('Transcript saved', 'success');
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  }
}

// ── History page ───────────────────────────────────────────────────────────

let _histAllClips = [];

function groupByDate(clips) {
  const map     = new Map();
  const today   = new Date().toDateString();
  const yest    = new Date(Date.now() - 86400000).toDateString();

  clips.forEach(c => {
    const d   = new Date(c.job_created_at);
    const key = d.toDateString();
    let label;
    if (key === today) {
      label = `Today · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    } else if (key === yest) {
      label = `Yesterday · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    } else {
      label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    if (!map.has(key)) map.set(key, { label, items: [] });
    map.get(key).items.push(c);
  });

  return [...map.values()];
}

function renderHistoryGrid(clips) {
  const wrap = document.getElementById('hist-list');
  if (!wrap) return;

  if (!clips.length) {
    wrap.innerHTML = '<div class="empty">No clips found.</div>';
    return;
  }

  const groups = groupByDate(clips);
  wrap.innerHTML = groups.map(g => `
    <div class="hist-date-group">
      <div class="hist-date-header">
        <span class="hist-date-label">${g.label}</span>
        <span class="hist-date-count">${g.items.length} clip${g.items.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="hist-grid">
        ${g.items.map(c => {
          const status = c.approved ? 'approved' : c.status;
          const src = c.source_url || '';
          const shortSrc = src.replace(/^https?:\/\/(www\.)?/, '').slice(0, 36);
          return `
            <div class="hist-card" data-job-id="${c.job_id}">
              <div class="hist-card-thumb">
                <div class="hist-thumb-pattern"></div>
                <div class="hist-card-status">${badge(status)}</div>
              </div>
              <div class="hist-card-title">${c.title}</div>
              <div class="hist-card-source" title="${src}">${shortSrc}</div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');

  $$('.hist-card[data-job-id]').forEach(card => {
    card.onclick = () => { location.hash = 'job/' + card.dataset.jobId; };
  });
}

async function showHistory() {
  clearTimeout(_listPoll);
  _listPoll = null;
  clearTimeout(_detailPoll);
  _detailPoll = null;
  _currentJobId = null;
  Object.keys(_bsugg).forEach(k => delete _bsugg[k]);
  setSidebarNav('history');

  app.innerHTML = `
    <div class="screen-header" style="flex-shrink:0">
      <div class="screen-header-row">
        <div>
          <h1 class="screen-title">History</h1>
          <div class="screen-subtitle">Every clip produced. Scan to avoid re-clipping the same moment.</div>
        </div>
      </div>
      <div class="history-filters">
        <div class="filter-search">
          <span style="color:var(--text-dim);font-size:12px">⌕</span>
          <input id="hist-search" placeholder="Search title or source…" autocomplete="off" />
        </div>
        <select id="hist-source" class="filter-select">
          <option value="">All sources</option>
        </select>
        <select id="hist-status" class="filter-select">
          <option value="">All statuses</option>
          <option value="ready">Ready</option>
          <option value="approved">Approved</option>
          <option value="delivered_local">Delivered (local)</option>
          <option value="delivered_gdrive">Delivered (Drive)</option>
          <option value="failed">Failed</option>
          <option value="rejected">Rejected</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="hist-clear">Clear</button>
      </div>
    </div>
    <div class="history-content" id="hist-list">
      <div class="loading">Loading…</div>
    </div>
  `;

  try {
    const sources = await api('GET', '/history/sources');
    const sel = $('#hist-source');
    sources.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60);
      sel.appendChild(opt);
    });
  } catch {}

  const rerender = () => renderHistoryList();

  $('#hist-source').onchange = rerender;
  $('#hist-status').onchange = rerender;
  $('#hist-search').oninput  = () => {
    const q = $('#hist-search').value.toLowerCase();
    const filtered = q
      ? _histAllClips.filter(c =>
          c.title.toLowerCase().includes(q) || (c.source_url || '').toLowerCase().includes(q))
      : _histAllClips;
    renderHistoryGrid(filtered);
  };
  $('#hist-clear').onclick = () => {
    $('#hist-source').value = '';
    $('#hist-status').value = '';
    $('#hist-search').value = '';
    rerender();
  };

  await renderHistoryList();
}

async function renderHistoryList() {
  const source = $('#hist-source')?.value || '';
  const status = $('#hist-status')?.value || '';

  const qs = new URLSearchParams();
  if (source) qs.set('source_url', source);
  if (status) qs.set('status', status);

  try {
    const res = await fetch('/api/history' + (qs.toString() ? '?' + qs : ''));
    if (!res.ok) throw new Error(res.statusText);
    _histAllClips = await res.json();

    const navCountEl = document.getElementById('nav-history-count');
    if (navCountEl) navCountEl.textContent = _histAllClips.length || '';

    const q = $('#hist-search')?.value?.toLowerCase() || '';
    const filtered = q
      ? _histAllClips.filter(c =>
          c.title.toLowerCase().includes(q) || (c.source_url || '').toLowerCase().includes(q))
      : _histAllClips;

    renderHistoryGrid(filtered);
  } catch (e) {
    const wrap = document.getElementById('hist-list');
    if (wrap) wrap.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

// ── Compose List ───────────────────────────────────────────────────────────────

let _composePoll;
let _newComposeModalEl = null;

async function showComposeList() {
  clearTimeout(_composePoll);
  clearTimeout(_listPoll);
  clearTimeout(_detailPoll);
  _composePoll = null;
  setSidebarNav('compose');

  app.innerHTML = `
    <div class="screen-header" style="flex-shrink:0">
      <div class="screen-header-row">
        <div>
          <h1 class="screen-title">Compose</h1>
          <div class="screen-subtitle">Assemble short vertical videos with voiceover, captions, and music.</div>
        </div>
        <button class="btn btn-primary" id="btn-new-compose">+ New compose</button>
      </div>
    </div>
    <div class="compose-table-header" id="compose-table-header" style="display:none">
      <div>Title</div><div>Status</div><div>Segments</div><div>Target</div><div>Updated</div><div></div>
    </div>
    <div class="screen-body" id="compose-list-wrap">
      <div class="loading">Loading…</div>
    </div>
  `;

  $('#btn-new-compose').onclick = openNewComposeModal;
  await renderComposeList();
}

async function renderComposeList() {
  const wrap = document.getElementById('compose-list-wrap');
  if (!wrap) return;

  try {
    const comps = await fetch('/api/compositions').then(r => r.json());

    const navEl = document.getElementById('nav-compose-count');
    if (navEl) navEl.textContent = comps.length || '';

    const hdr = document.getElementById('compose-table-header');

    if (!comps.length) {
      if (hdr) hdr.style.display = 'none';
      wrap.innerHTML = '<div class="empty">No compositions yet. Click "+ New compose" to start.</div>';
      return;
    }

    if (hdr) hdr.style.display = '';

    wrap.innerHTML = comps.map(c => `
      <div class="compose-row" onclick="location.hash='compose/${c.id}'">
        <div>
          <div class="job-row-title">${escAttr(c.title)}</div>
          <div class="job-row-sub">${fmtDate(c.updated_at)}</div>
        </div>
        <div>${badge(c.status)}</div>
        <div class="job-row-meta">${c.segment_count || 0} seg${c.segment_count !== 1 ? 's' : ''}</div>
        <div class="job-row-meta">${c.target_sec}s</div>
        <div class="job-row-age">${fmtAge(c.updated_at)}</div>
        <div class="job-row-chevron">›</div>
      </div>
    `).join('');
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

function openNewComposeModal() {
  if (_newComposeModalEl) return;

  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `
    <div class="modal modal-new-job" role="dialog" aria-modal="true" style="width:420px">
      <div class="modal-header">
        <span class="modal-title">New Composition</span>
        <button class="btn btn-ghost btn-sm" id="compose-modal-close">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px">
        <div class="form-field">
          <label class="form-label" for="compose-title-input">Title</label>
          <input class="form-input" id="compose-title-input" type="text"
                 placeholder="Untitled draft" autocomplete="off" />
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="btn btn-ghost btn-sm" id="compose-modal-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="compose-modal-proceed">Proceed</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(el);
  _newComposeModalEl = el;

  const close = () => { if (_newComposeModalEl) { _newComposeModalEl.remove(); _newComposeModalEl = null; } };
  document.getElementById('compose-modal-close').onclick  = close;
  document.getElementById('compose-modal-cancel').onclick = close;

  document.getElementById('compose-modal-proceed').onclick = async () => {
    const title = document.getElementById('compose-title-input').value.trim() || 'Untitled draft';
    try {
      const { id } = await api('POST', '/compositions', { title });
      close();
      location.hash = 'compose/' + id;
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  document.getElementById('compose-title-input').focus();
  document.getElementById('compose-title-input').onkeydown = e => {
    if (e.key === 'Enter') document.getElementById('compose-modal-proceed').click();
  };
}

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
      <label class="form-label" style="margin-top:8px">Trim Out (s)</label>
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
        toast('Segment added');
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
