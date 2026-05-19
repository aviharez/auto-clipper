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
  if (hash.startsWith('job/')) {
    showJobDetail(hash.slice(4));
  } else {
    showJobList();
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

// ── Job List ───────────────────────────────────────────────────────────────

let _listPoll;

async function showJobList() {
  clearInterval(_listPoll);
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
  _listPoll = setInterval(renderJobList, 3000);
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
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="empty">Error loading jobs: ${e.message}</div>`;
  }
}

// ── Job Detail ─────────────────────────────────────────────────────────────

let _detailPoll;

async function showJobDetail(jobId) {
  clearInterval(_detailPoll);

  breadcrumb.innerHTML = `
    <a href="#" onclick="location.hash='';return false;">Jobs</a>
    <span>/</span>
    <span id="bc-title">…</span>
  `;

  app.innerHTML = `<div class="loading">Loading job…</div>`;
  await renderJobDetail(jobId);
  _detailPoll = setInterval(() => renderJobDetail(jobId), 2500);
}

async function renderJobDetail(jobId) {
  try {
    const job = await api('GET', `/jobs/${jobId}`);
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
        body.classList.toggle('open');
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

  } catch (e) {
    app.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

function renderClipCard(c, forceOpen = false) {
  const dur = c.end - c.start;
  const isOpen = forceOpen || c.status === 'failed';
  const approvedClass = c.approved ? 'approved' : (c.status === 'rejected' ? 'rejected' : '');

  const hasVideo = c.status === 'ready' || c.status === 'approved' || c.status === 'uploaded';

  return `
  <div class="clip-card ${approvedClass}" id="clip-${c.id}">
    <div class="clip-header">
      <div class="clip-title">${c.title}</div>
      <div class="clip-meta">${fmtSecs(c.start)} – ${fmtSecs(c.end)} · ${fmtDuration(dur)}</div>
      <div style="margin-left:8px">${badge(c.approved ? 'approved' : c.status)}</div>
    </div>
    <div class="clip-body ${isOpen ? 'open' : ''}" data-cid="${c.id}">
      <div class="clip-layout">
        <div class="clip-video-wrap">
          ${hasVideo
            ? `<video controls src="/video/${c.id}" preload="metadata"></video>`
            : `<div class="clip-video-placeholder">${statusMsg(c)}</div>`
          }
        </div>
        <div class="clip-controls">
          ${c.hook_text ? `<div style="font-size:12px;color:var(--text-muted)">Hook: <em>${c.hook_text}</em></div>` : ''}

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

// ── Nudge state (local; committed on Regenerate) ───────────────────────────

const _nudge = {};  // cid -> { start, end }

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
  const bounds = _nudge[cid];
  const startEl = document.getElementById(`start-${cid}`);
  const endEl   = document.getElementById(`end-${cid}`);

  const start = bounds ? bounds.start : mmssToSecs(startEl.textContent);
  const end   = bounds ? bounds.end   : mmssToSecs(endEl.textContent);

  try {
    await api('PUT', `/candidates/${cid}/boundaries`, { start, end });
    delete _nudge[cid];
    toast('Recut queued…');
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
