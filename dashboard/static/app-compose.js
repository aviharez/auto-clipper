// ── Compose List ───────────────────────────────────────────────────────────────

let _composePoll;
let _newComposeModalEl = null;

let _composeListFilter = 'all'; // 'all' | 'drafts' | 'uploaded'

const _COMPOSE_UPLOADED_STATES = ['finalized', 'delivered_local', 'delivered_gdrive'];

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
      <div class="compose-filter-tabs" id="compose-filter-tabs">
        <button class="compose-tab ${_composeListFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
        <button class="compose-tab ${_composeListFilter === 'drafts' ? 'active' : ''}" data-filter="drafts">Drafts</button>
        <button class="compose-tab ${_composeListFilter === 'uploaded' ? 'active' : ''}" data-filter="uploaded">Uploaded</button>
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
  $$('.compose-tab').forEach(tab => {
    tab.onclick = () => {
      _composeListFilter = tab.dataset.filter;
      $$('.compose-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === _composeListFilter));
      renderComposeList();
    };
  });
  await renderComposeList();
}

async function renderComposeList() {
  const wrap = document.getElementById('compose-list-wrap');
  if (!wrap) return;

  try {
    const comps = await fetch('/api/compositions').then(r => r.json());

    const navEl = document.getElementById('nav-compose-count');
    if (navEl) navEl.textContent = comps.length || '';

    const filtered = comps.filter(c => {
      if (_composeListFilter === 'drafts') return !_COMPOSE_UPLOADED_STATES.includes(c.status);
      if (_composeListFilter === 'uploaded') return _COMPOSE_UPLOADED_STATES.includes(c.status);
      return true;
    });

    const hdr = document.getElementById('compose-table-header');

    if (!filtered.length) {
      if (hdr) hdr.style.display = 'none';
      const msg = _composeListFilter === 'uploaded'
        ? 'No finalized compositions yet.'
        : _composeListFilter === 'drafts'
        ? 'No drafts. Click "+ New compose" to start.'
        : 'No compositions yet. Click "+ New compose" to start.';
      wrap.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }

    if (hdr) hdr.style.display = '';

    wrap.innerHTML = filtered.map(c => `
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
