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
