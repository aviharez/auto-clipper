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

const ACTIVE_STATES = new Set([
  'pending','downloading','cutting','transcribing',
  'captioning','creating_hook','assembling','uploading',
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
    <div id="upload-panel" style="display:none">
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
    <div class="job-table-header" id="job-table-header" style="display:none">
      <div>Source</div><div>Status</div><div>Clips</div><div>Age</div><div></div>
    </div>
    <div class="screen-body" id="job-list-wrap">
      <div class="loading">Loading jobs…</div>
    </div>
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
    updateWorkerStatus(jobs);

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
      const shortUrl = url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 52);

      return `
        <div class="job-row" onclick="location.hash='job/${j.id}'">
          <div>
            <div class="job-row-title" title="${url}">${shortUrl}</div>
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
  setSidebarNav('jobs');

  app.innerHTML = `
    <div class="detail-header">
      <button class="detail-header-back" onclick="location.hash=''">← Jobs</button>
      <div class="detail-header-divider"></div>
      <div class="detail-header-main">
        <div class="detail-header-title">Loading…</div>
      </div>
    </div>
    <div class="screen-body" style="display:flex;align-items:center;justify-content:center">
      <div class="loading">Loading job…</div>
    </div>
  `;

  await renderJobDetail(jobId);
}

async function renderJobDetail(jobId) {
  if ($$('video').some(v => v.currentTime > 0 && !v.ended)) {
    _scheduleDetailPoll(jobId);
    return;
  }

  try {
    await loadPresets();
    const job = await api('GET', `/jobs/${jobId}`);

    const jobActive   = ACTIVE_STATES.has(job.status);
    const candsActive = job.candidates?.some(c => ACTIVE_STATES.has(c.status)) ?? false;
    clearTimeout(_detailPoll);
    _detailPoll = null;
    if (jobActive || candsActive) {
      _scheduleDetailPoll(jobId);
    }

    const meta         = JSON.parse(job.metadata_json || '{}');
    const title        = meta.title || job.source_url;
    const hasApproved  = job.candidates?.some(c => c.approved && c.status === 'ready');
    const approvedCount = job.candidates?.filter(c => c.approved).length ?? 0;
    const totalCount   = job.candidates?.length ?? 0;

    const openIds = new Set($$('.clip-body.open').map(el => el.dataset.cid));

    app.innerHTML = `
      <div class="detail-header" style="flex-shrink:0">
        <button class="detail-header-back" onclick="location.hash=''">← Jobs</button>
        <div class="detail-header-divider"></div>
        <div class="detail-header-main">
          <div class="detail-header-title" title="${title}">${title.length > 70 ? title.slice(0, 70) + '…' : title}</div>
          <div class="detail-header-meta">${fmtDate(job.created_at)} · ${totalCount} clip${totalCount !== 1 ? 's' : ''}</div>
        </div>
        ${badge(job.status)}
        <div class="detail-header-stats" style="${totalCount ? '' : 'display:none'}">
          <div>${approvedCount} of ${totalCount} reviewed</div>
          <div class="detail-header-approved">${approvedCount} approved</div>
        </div>
        ${hasApproved ? `<button class="btn btn-primary btn-sm" id="btn-publish">↑ Upload ${approvedCount} approved</button>` : ''}
        ${job.status === 'failed' ? `<button class="btn btn-ghost btn-sm" id="btn-retry">↺ Retry</button>` : ''}
      </div>
      <div class="job-info-bar" style="flex-shrink:0">
        <div>Status: <strong>${job.status}</strong></div>
        <div>Created: <strong>${fmtDate(job.created_at)}</strong></div>
        <div>Clips: <strong>${totalCount}</strong></div>
        ${job.error ? `<div style="color:var(--red)">${job.error.split('\n')[0]}</div>` : ''}
      </div>
      <div class="screen-body">
        <div class="clip-list" id="clip-list">
          ${(job.candidates || []).map(c => renderClipCard(c, openIds.has(c.id))).join('')}
          ${!job.candidates?.length ? '<div class="empty">No clips yet — processing may still be running.</div>' : ''}
        </div>
      </div>
    `;

    if (hasApproved) $('#btn-publish').onclick = () => publishJob(jobId);
    const retryBtn = document.getElementById('btn-retry');
    if (retryBtn) retryBtn.onclick = () => retryJob(jobId);

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

    $$('[data-nudge]').forEach(btn => {
      btn.onclick = () => nudge(btn, jobId);
    });

    $$('[data-preset-type]').forEach(sel => {
      sel.onchange = () => changePreset(sel.dataset.cid, sel.dataset.presetType, sel.value, jobId);
    });

  } catch (e) {
    app.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

function renderClipCard(c, forceOpen = false) {
  const dur          = c.end - c.start;
  const isOpen       = forceOpen || c.status === 'failed';
  const approvedClass = c.approved ? 'approved' : (c.status === 'rejected' ? 'rejected' : '');
  const hasVideo     = c.status === 'ready' || c.status === 'approved' || c.status === 'uploaded';

  const cp       = _presets?.caption || {};
  const cpKeys   = Object.keys(cp);
  const effectiveHookPreset = c.hook_preset || c.caption_preset;

  const presetBlock = cpKeys.length ? `
    <div class="preset-row">
      ${c.needs_caption
        ? `<div class="preset-field">
             <label class="preset-label">Caption</label>
             <select class="preset-select" data-preset-type="caption" data-cid="${c.id}">
               ${_presetOptions(c.caption_preset, cp)}
             </select>
           </div>`
        : ''}
      ${c.hook_enabled && c.hook_text
        ? `<div class="preset-field">
             <label class="preset-label">Hook style</label>
             <select class="preset-select" data-preset-type="hook" data-cid="${c.id}">
               ${_presetOptions(effectiveHookPreset, cp)}
             </select>
           </div>`
        : ''}
    </div>` : '';

  // Stub placeholders — space reserved for upcoming 2.5 features
  const stubHookVideo = `
    <div class="stub-section">
      <div class="stub-label">Hook video · 2.5.5</div>
      <div class="stub-body">Custom hook background upload</div>
    </div>`;

  const stubTranscript = `
    <div class="stub-section">
      <div class="stub-label">Transcript editor · 2.5.6</div>
      <div class="stub-body">Word-by-word correction</div>
    </div>`;

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
              ? `<video controls src="/video/${c.id}" preload="metadata"></video>
                 <div class="clip-video-overlay-stub"></div>`
              : `<div class="clip-video-placeholder">${statusMsg(c)}</div>`
            }
          </div>
          ${hasVideo ? `<div class="clip-video-label">${previewLabel(c)}</div>` : ''}
        </div>

        <div class="clip-controls">
          ${c.hook_text ? `<div style="font-size:11px;color:var(--text-muted)">Hook: <em>${c.hook_text}</em></div>` : ''}

          ${presetBlock}

          ${c.hook_enabled ? stubHookVideo : ''}

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

          ${stubTranscript}

          <div class="clip-actions">
            <button class="btn btn-ghost btn-sm" data-recut="${c.id}">↻ Regenerate</button>
            ${c.approved
              ? `<button class="btn btn-ghost btn-sm" data-reject="${c.id}">✕ Unapprove</button>`
              : `<button class="btn btn-primary btn-sm" data-approve="${c.id}">✓ Approve</button>
                 <button class="btn btn-ghost-danger btn-sm" data-reject="${c.id}">✕ Reject</button>`
            }
            ${c.youtube_url ? `<a href="${c.youtube_url}" target="_blank" class="btn btn-ghost btn-sm" onclick="event.stopPropagation()">▶ YouTube</a>` : ''}
          </div>

          ${c.error ? `<div class="clip-error">${c.error}</div>` : ''}
        </div>
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

// ── Nudge state ────────────────────────────────────────────────────────────

const _nudge       = {};  // cid -> { start, end }
const _bsugg       = {};  // cid -> suggestion object | null
const _presetDirty = {};  // cid -> true when preset changed but not regenerated

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
  const hasPreset = !!_presetDirty[cid];

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
          <option value="uploaded">Uploaded</option>
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
