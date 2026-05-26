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
