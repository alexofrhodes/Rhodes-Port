import { apiUrl } from './api.js';
import { BRAND, SHIPS, PORTS } from './config.js';
import { fetchShips } from './data/ships.js';
import { createMap } from './ui/map.js';
import {
  createTable,
  COLS_SHIP_COMPACT,
} from './ui/table.js';
import { createDetail } from './ui/detail.js';

const state = {
  mode: 'ship',
  raw: [],
  rows: [],
  timer: null,
  updatedAt: null,
  stale: false,
  ports: new Set(PORTS.map((p) => p.id)),
  rhodesOnly: true,
  noCruise: true,
  starredOnly: false,
  query: '',
  selectedId: null,
  totalUnfiltered: 0,
  providers: { ships: [], selected: { ships: 'auto' } },
};

const indexCountEl = document.getElementById('index-count');
const qEl = document.getElementById('q');
const qClearEl = document.getElementById('q-clear');
const mapApi = createMap(document.getElementById('map'));
const tableApi = createTable({
  root: document.getElementById('table'),
  onSelect: (id) => select(id),
  onCount: (shown, total) => {
    const label = 'ships';
    indexCountEl.textContent = `${shown} shown · ${total} loaded ${label}`;
  },
  onEditNotes: (row) => editNotesDialog(row),
  onToggleStar: (row) => starRow(row),
});
const detailApi = createDetail(document.getElementById('detail'));

const statusEl = document.getElementById('status-line');
const staleEl = document.getElementById('stale-banner');
document.getElementById('brand').textContent = BRAND;

function compactKeys() {
  return COLS_SHIP_COMPACT;
}

function select(id) {
  state.selectedId = id;
  tableApi.select(id);
  mapApi.select(id);
  detailApi.render(tableApi.getRow(id));
}

function buildPortFilters() {
  const el = document.getElementById('port-filters');
  el.innerHTML =
    `<strong>Ports:</strong> ` +
    PORTS.map(
      (p) =>
        `<label><input type="checkbox" data-port="${p.id}" checked /> ${p.name}</label>`,
    ).join(' ');
  el.querySelectorAll('input[data-port]').forEach((inp) => {
    inp.addEventListener('change', () => {
      state.ports = new Set(
        [...el.querySelectorAll('input[data-port]:checked')].map((i) => i.dataset.port),
      );
      refresh(false, true);
    });
  });
}

function setMode(mode) {
  state.mode = mode;
  syncStarButtonLabels();
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  fillProviderSelect();
  loadOperators();
  refresh(true, true);
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function setStale(on, msg) {
  state.stale = on;
  const text = on || msg ? msg || 'Showing previous data — may not be live. Press Refresh.' : '';
  staleEl.textContent = text;
  staleEl.classList.toggle('is-empty', !text);
}

function syncClearBtn() {
  qClearEl.classList.toggle('visible', !!state.query.trim());
}

function applyLocalFilters() {
  let rows = state.raw.slice();
  if (state.noCruise) rows = rows.filter((r) => r.class !== 'cruise');
  if (state.query.trim()) {
    const tokens = state.query
      .toLowerCase()
      .replace(/,/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    rows = rows.filter((r) => {
      const blob = JSON.stringify(r).toLowerCase();
      return tokens.every((t) => blob.includes(t));
    });
  }
  state.rows = rows;
  tableApi.setData(rows, state.mode, compactKeys());
  mapApi.setRows(rows, state.mode, select);
  setStatus(
    `${state.stale ? 'STALE' : 'Live'} · ${state.updatedAt ? state.updatedAt.toLocaleTimeString() : '—'} · ${rows.length} in port / will dock`,
    false,
  );
  syncClearBtn();
}

async function refresh(fit = false, forceNetwork = false) {
  setStatus('Loading…');
  try {
    let payload;
    const ports = [...state.ports].join(',');
    payload = await fetchShips({
      refresh: forceNetwork,
      ports,
      rhodesOnly: state.rhodesOnly,
      noCruise: state.noCruise,
      starred: state.starredOnly,
    });
    state.raw = payload.rows;
    state.totalUnfiltered = payload.total_unfiltered ?? payload.rows.length;
    state.updatedAt = payload.retrieved_at ? new Date(payload.retrieved_at) : new Date();
    if (payload.stale) setStale(true);
    else setStale(false);
    applyLocalFilters();
    if (fit) mapApi.fitLive();
    mapApi.invalidate?.();
  } catch (err) {
    setStale(true, `API error: ${err.message}. Use Start server in the Python GUI, then Refresh.`);
    if (state.raw.length) {
      applyLocalFilters();
      setStatus(`Fetch failed — kept previous (${err.message})`, true);
    } else {
      setStatus(`Error: ${err.message}`, true);
      indexCountEl.textContent = '0 shown · 0 loaded';
    }
  }
}

function schedule() {
  clearInterval(state.timer);
  const ms = SHIPS.pollMs;
  state.timer = setInterval(() => refresh(false, false), ms);
}

function printView() {
  const cols = tableApi.getVisibleKeys();
  const rows = state.rows;
  const mode = 'Ships';
  const w = window.open('', '_blank');
  const head = cols.map((c) => `<th>${c}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${cols.map((c) => `<td>${r[c] ?? ''}</td>`).join('')}</tr>`)
    .join('');
  w.document.write(
    `<html><head><title>Live ${mode} print</title><style>
      body{font:13px/1.4 system-ui,sans-serif;margin:1rem;color:#14222a}
      h1{font:700 1.25rem Georgia,serif;margin:0 0 .35rem}
      .meta{color:#5a6d72;margin:0 0 1rem}
      table{border-collapse:collapse;width:100%}
      td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}
      th{background:#f3f7f6;font-size:.75rem;text-transform:uppercase}
    </style></head><body>
      <h1>Rhodes Port Tracker — Live ${mode}</h1>
      <p class="meta">${rows.length} filtered rows · ${new Date().toLocaleString()}</p>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <script>print()<\\/script></body></html>`,
  );
  w.document.close();
}

function renderOps(list, root) {
  root.innerHTML = (list || [])
    .map(
      (op) => `<article class="op-card">
        <h3>${escapeHtml(op.name)}</h3>
        <p class="muted">${escapeHtml(op.notes || '')}</p>
        <p class="op-links">
          ${op.website ? `<a href="${escapeAttr(op.website)}" target="_blank" rel="noopener">Site</a>` : ''}
          ${op.schedules ? `<a href="${escapeAttr(op.schedules)}" target="_blank" rel="noopener">Schedules</a>` : ''}
          ${op.contact ? `<a href="tel:${escapeAttr(String(op.contact).replace(/\s/g, ''))}">${escapeHtml(op.contact)}</a>` : ''}
        </p>
      </article>`,
    )
    .join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function forecastTable(rows) {
  if (!rows?.length) return '<p class="muted">No route patterns configured.</p>';
  const body = rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.operator || '')}</td>
        <td>${escapeHtml(r.route || '')}</td>
        <td>${escapeHtml(r.berth || '')}</td>
        <td>${escapeHtml(r.pattern || '')}</td>
        <td class="op-links">
          ${r.schedules ? `<a href="${escapeAttr(r.schedules)}" target="_blank" rel="noopener">Schedules</a>` : ''}
          ${r.website ? `<a href="${escapeAttr(r.website)}" target="_blank" rel="noopener">Site</a>` : ''}
          ${r.contact ? `<span>${escapeHtml(r.contact)}</span>` : ''}
        </td>
      </tr>`,
    )
    .join('');
  return `<div class="table-x"><table class="sched-table"><thead><tr>
    <th>Operator</th><th>Route</th><th>Berth</th><th>Pattern</th><th>Links</th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
}

const schedUi = {
  data: null,
  published: [],
  publishedNote: '',
  scope: 'all',
  view: 'table',
  showProj: true,
  showCruise: true,
};

function filterCalls(list) {
  let rows = list || [];
  if (schedUi.scope === 'starred') rows = rows.filter((r) => r.starred);
  if (!schedUi.showProj) rows = rows.filter((r) => !r.projected);
  if (!schedUi.showCruise) rows = rows.filter((r) => r.kind !== 'cruise');
  return rows;
}

function callSheetTable(rows, { published = false } = {}) {
  if (!rows.length) {
    return published
      ? '<p class="muted">No Ferryhopper cache for this month yet. Run <code>python -m rhodesport ferryhopper --date YYYY-MM-DD</code> or press Fetch today below.</p>'
      : '<p class="muted">No call-sheet rows for this filter. Star vessels on the live table, or switch to All AIS.</p>';
  }
  const body = rows
    .map(
      (r) => `<tr class="${r.projected ? 'row-proj' : ''} ${r.starred ? 'row-star' : ''}">
        <td>${escapeHtml(r.date_display || r.date || '')}</td>
        <td>${escapeHtml(r.weekday || '')}</td>
        <td>${r.starred ? '★ ' : ''}${escapeHtml(r.vessel || '')}${r.projected ? ' <span class="pill">proj</span>' : ''}
          <button type="button" class="ghost-dark star-call" data-key="${escapeAttr(r.mmsi || r.vessel || '')}">${r.starred ? 'Remove star' : 'Star'}</button></td>
        <td>${escapeHtml(r.operator || '')}</td>
        <td>${escapeHtml(r.kind_label || r.kind || '')}</td>
        <td>${escapeHtml(r.arrive || '—')}</td>
        <td>${escapeHtml(r.depart || '—')}</td>
        <td>${escapeHtml(r.route || ((r.origin && r.origin !== '—') ? r.origin + ' → ' + (r.dest || '—') : (r.dest || '—')))}</td>
        <td>${escapeHtml(r.origin || '—')}</td>
        <td>${escapeHtml(r.dest || '—')}</td>
        <td>${escapeHtml(r.via || '—')}</td>
        <td>${escapeHtml(r.price || r.berth || '—')}</td>
        <td>${
          r.book_url
            ? `<a href="${escapeAttr(r.book_url)}" target="_blank" rel="noopener">Book</a>`
            : escapeHtml(r.source || '')
        }</td>
      </tr>`,
    )
    .join('');
  const priceOrBerth = published ? 'Price' : 'Berth';
  const srcOrLink = published ? 'Link' : 'Source';
  return `<div class="table-x"><table class="sched-table sched-calls"><thead><tr>
    <th>Date</th><th>Day</th><th>Vessel</th><th>Operator</th><th>Type</th>
    <th>${published ? 'Arr dest' : 'Arr Rhodes'}</th><th>Dep Rhodes</th><th>From → To</th><th>From</th><th>To</th><th>Via</th><th>${priceOrBerth}</th><th>${srcOrLink}</th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
}

function callSheetCards(rows) {
  if (!rows.length) {
    return '<p class="muted">No call-sheet rows for this filter.</p>';
  }
  return `<div class="call-cards">${rows
    .map(
      (r) => `<article class="call-card ${r.projected ? 'is-proj' : ''}">
        <header>
          <strong>${r.starred ? '★ ' : ''}${escapeHtml(r.vessel || '')}</strong>
          <span>${escapeHtml(r.date_display || '')} · ${escapeHtml(r.weekday || '')}</span>
        </header>
        <p class="call-meta">${escapeHtml(r.operator || '—')} · ${escapeHtml(r.kind_label || r.kind || '')}</p>
        <dl class="call-times">
          <div><dt>Arr</dt><dd>${escapeHtml(r.arrive || '—')}</dd></div>
          <div><dt>Dep</dt><dd>${escapeHtml(r.depart || '—')}</dd></div>
          <div><dt>Dest</dt><dd>${escapeHtml(r.dest || '—')}</dd></div>
          <div><dt>Via</dt><dd>${escapeHtml(r.via || '—')}</dd></div>
          <div><dt>${r.price ? 'Price' : 'Berth'}</dt><dd>${escapeHtml(r.price || r.berth || '—')}</dd></div>
          <div><dt>Source</dt><dd>${
            r.book_url
              ? `<a href="${escapeAttr(r.book_url)}" target="_blank" rel="noopener">Book</a>`
              : escapeHtml(r.source || '') + (r.projected ? ' (proj)' : '')
          }</dd></div>
        </dl>
      </article>`,
    )
    .join('')}</div>`;
}

function renderCallsPane() {
  const pane = document.getElementById('tab-calls');
  if (!pane || !schedUi.data) return;
  const rows = filterCalls(schedUi.data.calls || []);
  pane.innerHTML = schedUi.view === 'cards' ? callSheetCards(rows) : callSheetTable(rows);
}

function renderPublishedPane() {
  const pane = document.getElementById('tab-published');
  if (!pane) return;
  const rows = schedUi.published || [];
  const actions = `<p class="sched-pub-actions">
    <button type="button" class="ghost-dark" id="fh-fetch-today">Fetch today (Ferryhopper)</button>
    <a class="ghost-dark" id="fh-open-report" href="./ferries.html" target="_blank" rel="noopener">Open planner</a>
    <span class="muted">${escapeHtml(schedUi.publishedNote || '')}</span>
  </p>`;
  const body =
    schedUi.view === 'cards' ? callSheetCards(rows) : callSheetTable(rows, { published: true });
  pane.innerHTML = actions + body;
  document.getElementById('fh-fetch-today')?.addEventListener('click', () => fetchFerryhopperToday());
}

async function fetchFerryhopperToday() {
  const pane = document.getElementById('tab-published');
  const day = new Date().toISOString().slice(0, 10);
  if (pane) pane.innerHTML = `<p class="muted">Fetching Ferryhopper for ${day} (may take a minute)…</p>`;
  try {
    const res = await fetch(apiUrl(`api/ferryhopper?date=${day}&refresh=1`), { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    const month = (document.getElementById('sched-month')?.value || day).slice(0, 7);
    await loadPublished(month);
    renderPublishedPane();
  } catch (e) {
    if (pane) pane.innerHTML = `<p class="muted">Ferryhopper fetch failed: ${escapeHtml(String(e.message || e))}</p>`;
  }
}

async function loadPublished(month) {
  try {
    const res = await fetch(apiUrl(`api/ferryhopper?month=${month}`), { cache: 'no-store' });
    const data = await res.json();
    schedUi.published = data.sailings || [];
    schedUi.publishedNote = data.note || `${schedUi.published.length} published sailings`;
  } catch (e) {
    schedUi.published = [];
    schedUi.publishedNote = String(e.message || e);
  }
}

function bindScheduleTabs() {
  document.querySelectorAll('.sched-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sched-tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.sched-pane').forEach((p) => {
        p.hidden = true;
        p.classList.remove('active');
      });
      btn.classList.add('active');
      const pane = document.getElementById(`tab-${btn.dataset.tab}`);
      if (pane) {
        pane.hidden = false;
        pane.classList.add('active');
      }
    });
  });
  document.querySelectorAll('#sched-toolbar [data-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sched-toolbar [data-scope]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      schedUi.scope = btn.dataset.scope;
      renderCallsPane();
    });
  });
  document.querySelectorAll('#sched-toolbar [data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sched-toolbar [data-view]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      schedUi.view = btn.dataset.view;
      renderCallsPane();
      renderPublishedPane();
    });
  });
  document.getElementById('sched-proj')?.addEventListener('change', (e) => {
    schedUi.showProj = e.target.checked;
    renderCallsPane();
  });
  document.getElementById('sched-cruise')?.addEventListener('change', (e) => {
    schedUi.showCruise = e.target.checked;
    renderCallsPane();
  });
  document.getElementById('sched-month')?.addEventListener('change', (e) => {
    openSchedule(e.target.value);
  });
  document.getElementById('tab-calls')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.star-call');
    if (!btn || !btn.dataset.key) return;
    try {
      await toggleStar('vessels', btn.dataset.key);
      const month = document.getElementById('sched-month')?.value;
      await openSchedule(month);
    } catch (err) {
      alert(err.message);
    }
  });
  if (!document.getElementById('sched-clear-stars')) {
    const bar = document.getElementById('sched-toolbar');
    if (bar) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'sched-clear-stars';
      b.className = 'ghost-dark';
      b.textContent = 'Clear all ★';
      b.addEventListener('click', async () => {
        try {
          await clearAllStars();
          const month = document.getElementById('sched-month')?.value;
          await openSchedule(month);
        } catch (err) {
          alert(err.message);
        }
      });
      bar.appendChild(b);
    }
  }
}

async function openSchedule(monthOverride) {
  const month = monthOverride || new Date().toISOString().slice(0, 7);
  const dlg = document.getElementById('schedule-dialog');
  const note = document.getElementById('schedule-note');
  const stats = document.getElementById('schedule-stats');
  const title = document.getElementById('schedule-title');
  const monthInput = document.getElementById('sched-month');
  if (monthInput && monthInput.value !== month) monthInput.value = month;
  title.textContent = `Month call sheet — ${month}`;
  note.textContent = 'Loading…';
  stats.textContent = '';
  document.getElementById('tab-calls').innerHTML = '';
  document.getElementById('tab-patterns').innerHTML = '';
  const pub = document.getElementById('tab-published');
  if (pub) pub.innerHTML = '';
  if (!dlg.open) dlg.showModal();
  try {
    const res = await fetch(apiUrl(`api/month-routes?month=${month}`), { cache: 'no-store' });
    const data = await res.json();
    schedUi.data = data;
    note.textContent = data.note || '';
    const s = data.stats || {};
    stats.textContent =
      `${s.calls || 0} call rows · ★ ${s.starred_calls || 0} · ` +
      `projected ${s.projected || 0} · AIS vessel-days ${s.vessel_days || 0} · ` +
      `${s.vessels || 0} vessels`;
    document.getElementById('tab-patterns').innerHTML = forecastTable(
      data.patterns || data.forecast || [],
    );
    await loadPublished(month);
    renderCallsPane();
    renderPublishedPane();
  } catch (e) {
    note.textContent = String(e.message || e);
  }
}

async function loadOperators() {
  const mode = 'ship';
  try {
    const res = await fetch(apiUrl(`api/operators?mode=${mode}`), { cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json();
    renderOps(body.operators, document.getElementById('operators'));
  } catch {
    /* offline shell */
  }
}

function fillProviderSelect() {
  const sel = document.getElementById('provider');
  if (!sel) return;
  const kind = 'ships';
  const list = state.providers[kind] || [];
  const selected = (state.providers.selected || {})[kind] || list[0]?.id || '';
  sel.innerHTML = list
    .map((p) => `<option value="${escapeAttr(p.id)}" ${p.id === selected ? 'selected' : ''}>${escapeHtml(p.label)}</option>`)
    .join('');
}

async function loadProviders() {
  try {
    const res = await fetch(apiUrl('api/providers'), { cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json();
    state.providers = {
      ships: body.ships || [],
      selected: body.selected || { ships: 'auto' },
    };
    fillProviderSelect();
  } catch {
    /* ignore */
  }
}

document.getElementById('provider').addEventListener('change', async (e) => {
  const id = e.target.value;
  const kind = 'ships';
  const body = { ships: id, refetch: kind };
  try {
    const res = await fetch(apiUrl('api/providers'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('provider save failed');
    const data = await res.json();
    state.providers.selected = data.selected || state.providers.selected;
    setStatus(`Provider → ${id} · refreshing…`);
    await refresh(false, true);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('rhodes-only').addEventListener('change', (e) => {
  state.rhodesOnly = e.target.checked;
  refresh(false, true);
});
document.getElementById('starred-only')?.addEventListener('change', (e) => {
  state.starredOnly = e.target.checked;
  refresh(false, true);
});
document.getElementById('no-cruise').addEventListener('change', (e) => {
  state.noCruise = e.target.checked;
  applyLocalFilters();
});
qEl.addEventListener('input', (e) => {
  state.query = e.target.value;
  applyLocalFilters();
});
qClearEl.addEventListener('click', () => {
  state.query = '';
  qEl.value = '';
  applyLocalFilters();
  qEl.focus();
});

async function editNotesDialog(row) {
  if (!row?.note_key) {
    alert('No stable key for notes on this row');
    return;
  }
  const note = window.prompt('Note (saved persistently)', row.note || '');
  if (note === null) return;
  const links = window.prompt(
    'Links — [label](https://…) or bare https:// URL (one per line ok)',
    row.links || '',
  );
  if (links === null) return;
  try {
    const res = await fetch(apiUrl('api/notes'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: row.note_key, note, links }),
    });
    if (!res.ok) throw new Error('save failed');
    row.note = note;
    row.links = links;
    const raw = state.raw.find((r) => r.id === row.id);
    if (raw) {
      raw.note = note;
      raw.links = links;
      raw.note_key = row.note_key;
    }
    applyLocalFilters();
    select(row.id);
  } catch (e) {
    alert(e.message);
  }
}

async function toggleStar(kind, value) {
  const res = await fetch(apiUrl('api/stars'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toggle: true, kind, value }),
  });
  if (!res.ok) throw new Error('star failed');
  await refresh(false, true);
}

async function clearAllStars() {
  if (!window.confirm('Remove every star (vessels, destinations)?')) return;
  const res = await fetch(apiUrl('api/stars'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear: 'all' }),
  });
  if (!res.ok) throw new Error('clear stars failed');
  await refresh(false, true);
}

async function starRow(row) {
  if (!row) return alert('Select a Live row first');
  await toggleStar('vessels', row.mmsi || row.name);
}

function syncStarButtonLabels() {
  const v = document.getElementById('star-vessel');
  const d = document.getElementById('star-dest');
  if (v) v.textContent = '★ Vessel';
  if (d) d.textContent = '★ AIS dest';
}

document.getElementById('star-vessel')?.addEventListener('click', async () => {
  try {
    await starRow(tableApi.getRow(state.selectedId));
  } catch (e) {
    alert(e.message);
  }
});
document.getElementById('star-dest')?.addEventListener('click', async () => {
  const row = tableApi.getRow(state.selectedId);
  if (!row) return alert('Select a Live row first');
  try {
    await toggleStar('destinations', row.dest || row.to);
  } catch (e) {
    alert(e.message);
  }
});
document.getElementById('star-clear')?.addEventListener('click', async () => {
  try {
    await clearAllStars();
  } catch (e) {
    alert(e.message);
  }
});
syncStarButtonLabels();

document.getElementById('dashboard')?.addEventListener('click', () => {
  window.open(apiUrl('api/dashboard?mode=ships&format=html'), '_blank');
});

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    // Ships only in the Live UI.
    setMode('ship');
    schedule();
  });
});
document.getElementById('refresh').addEventListener('click', () => refresh(false, true));
document.getElementById('print').addEventListener('click', printView);
document.getElementById('about-btn')?.addEventListener('click', () => {
  alert(
    'Rhodes Port Tracker — ferry planner + live AIS ships.\n\n' +
      'Alex of Rhodes\n' +
      'alexofrhodes@gmail.com\n' +
      'https://github.com/alexofrhodes\n\n' +
      'Ferries = Ferryhopper cache planner · Ports = facilities map · Live = AIS.\n\n' +
      'Disruptions banner on Ferries = Ferryhopper country alerts (not weather).\n' +
      'Print = current filtered Live table or Ferries view on screen.\n' +
      'Search: space-separated partials (all must match).',
  );
});

buildPortFilters();
loadProviders();
loadOperators();
bindScheduleTabs();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.update());
  });
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
setMode('ship');
schedule();
