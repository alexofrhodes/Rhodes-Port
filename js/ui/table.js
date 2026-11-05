/** Sortable table with per-column popup checkbox filters + column picker. */

const COLS_SHIP_DEFAULT = [
  { key: 'starred', label: '★' },
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'port', label: 'Port' },
  { key: 'likely_port', label: 'Likely berth' },
  { key: 'dest', label: 'Dest' },
  { key: 'eta', label: 'ETA' },
  { key: 'note', label: 'Note' },
  { key: 'links', label: 'Links' },
  { key: 'operator', label: 'Operator' },
  { key: 'km', label: 'km' },
  { key: 'sog', label: 'SOG' },
  { key: 'will_dock', label: 'Will dock' },
  { key: 'fleet_track', label: 'Fleet' },
  { key: 'class', label: 'Class' },
  { key: 'type', label: 'AIS type' },
  { key: 'flag', label: 'Flag' },
  { key: 'mmsi', label: 'MMSI' },
  { key: 'imo', label: 'IMO' },
  { key: 'callsign', label: 'Callsign' },
  { key: 'cog', label: 'COG' },
  { key: 'length', label: 'Len' },
  { key: 'draught', label: 'Draught' },
  { key: 'lat', label: 'Lat' },
  { key: 'lon', label: 'Lon' },
  { key: 'seen', label: 'Seen' },
];

const COLS_SHIP_COMPACT = [
  'starred', 'name', 'class', 'status', 'port', 'likely_port', 'dest', 'eta', 'note', 'links', 'km',
];


function parseLinks(text) {
  const s = text || '';
  const found = [];
  const seen = new Set();
  const md = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  let m;
  while ((m = md.exec(s))) {
    if (!seen.has(m[2])) {
      seen.add(m[2]);
      found.push({ label: m[1] || m[2], url: m[2] });
    }
  }
  const rest = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, ' ');
  const bare = /(https?:\/\/[^\s<>"']+)/gi;
  while ((m = bare.exec(rest))) {
    const url = m[1].replace(/[.,);]+$/, '');
    if (!seen.has(url)) {
      seen.add(url);
      found.push({ label: url, url });
    }
  }
  return found;
}

function fmt(row, key) {
  const v = row[key];
  if (key === 'starred') return v ? '★' : '☆';
  if (key === 'will_dock' || key === 'will_land' || key === 'fleet_track') return v ? 'yes' : '';
  if (v == null || v === '') return '—';
  if (typeof v === 'number') {
    if (key === 'lat' || key === 'lon') return v.toFixed(5);
    if (key === 'sog' || key === 'speed' || key === 'km' || key === 'distKm') return v.toFixed(1);
  }
  return String(v);
}

function cellHtml(row, key) {
  if (key === 'starred') {
    const on = !!row.starred;
    return `<button type="button" class="star-cell" data-star="1" title="${on ? 'Remove star' : 'Star'}">${on ? '★' : '☆'}</button>`;
  }
  if (key === 'links') {
    const items = parseLinks(row.links || '');
    if (row.operator_url) items.push({ label: 'Op', url: row.operator_url });
    if (row.operator_schedules) items.push({ label: 'Sched', url: row.operator_schedules });
    if (!items.length) return '—';
    return items
      .map(
        (it) =>
          `<a class="cell-link" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.label)}</a>`,
      )
      .join(' · ');
  }
  if (key === 'note') {
    const t = row.note || '';
    if (!t) return '<span class="muted-cell">edit</span>';
    return escapeHtml(t.length > 48 ? `${t.slice(0, 48)}…` : t);
  }
  return escapeHtml(fmt(row, key));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function uniqueValues(rows, key) {
  const set = new Set();
  for (const r of rows) {
    const v = r[key];
    set.add(v == null || v === '' ? '(empty)' : String(v));
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function createTable({ root, onSelect, onCount, onEditNotes, onToggleStar }) {
  let allRows = [];
  let mode = 'ship';
  let selectedId = null;
  let sortKey = 'km';
  let sortDir = 1;
  /** @type {Set<string>|null} */
  let visibleKeys = null;
  /** @type {Record<string, Set<string>|null>} null = all selected */
  let colFilters = {};
  let openPopup = null;

  root.innerHTML = `
    <div class="table-toolbar">
      <span class="table-count" id="count"></span>
      <button type="button" class="ghost-dark" id="btn-cols">Columns…</button>
      <button type="button" class="ghost-dark" id="btn-clear-filters">Clear column filters</button>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr id="head"></tr></thead>
        <tbody id="body"></tbody>
      </table>
    </div>
    <div id="popup-root"></div>
  `;

  const headEl = root.querySelector('#head');
  const bodyEl = root.querySelector('#body');
  const countEl = root.querySelector('#count');
  const popupRoot = root.querySelector('#popup-root');

  function allCols() {
    return COLS_SHIP_DEFAULT;
  }

  function cols() {
    const all = allCols();
    if (!visibleKeys || !visibleKeys.length) return all;
    const set = visibleKeys;
    const filtered = all.filter((c) => set.has(c.key));
    return filtered.length ? filtered : all;
  }

  function filteredRows() {
    return allRows.filter((r) => {
      for (const [key, allowed] of Object.entries(colFilters)) {
        if (!allowed) continue;
        const raw = r[key];
        const val = raw == null || raw === '' ? '(empty)' : String(raw);
        if (!allowed.has(val)) return false;
      }
      return true;
    });
  }

  function sorted(list) {
    const out = list.slice();
    out.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sortDir;
    });
    return out;
  }

  function closePopup() {
    openPopup = null;
    popupRoot.innerHTML = '';
  }

  function openCheckboxPopup({ title, values, selected, onApply, anchorEl }) {
    closePopup();
    openPopup = title;
    const rect = anchorEl.getBoundingClientRect();
    const wrap = document.createElement('div');
    wrap.className = 'filter-popup';
    wrap.style.top = `${rect.bottom + window.scrollY + 4}px`;
    wrap.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 280)}px`;

    const selectedSet = new Set(selected);
    wrap.innerHTML = `
      <div class="filter-popup-head">
        <strong>${escapeHtml(title)}</strong>
        <input type="search" class="popup-search" placeholder="Search values…" />
      </div>
      <div class="filter-popup-actions">
        <button type="button" data-act="all">All</button>
        <button type="button" data-act="none">None</button>
      </div>
      <div class="filter-popup-list"></div>
      <div class="filter-popup-foot">
        <button type="button" data-act="apply" class="primary">Apply</button>
        <button type="button" data-act="cancel">Cancel</button>
      </div>
    `;
    const listEl = wrap.querySelector('.filter-popup-list');
    const searchEl = wrap.querySelector('.popup-search');

    function paint(q = '') {
      const qq = q.trim().toLowerCase();
      listEl.innerHTML = values
        .filter((v) => !qq || v.toLowerCase().includes(qq))
        .map(
          (v) =>
            `<label><input type="checkbox" value="${escapeHtml(v)}" ${selectedSet.has(v) ? 'checked' : ''}/> ${escapeHtml(v)}</label>`,
        )
        .join('');
    }
    paint();

    searchEl.addEventListener('input', () => paint(searchEl.value));
    wrap.querySelector('[data-act="all"]').onclick = () => {
      values.forEach((v) => selectedSet.add(v));
      paint(searchEl.value);
    };
    wrap.querySelector('[data-act="none"]').onclick = () => {
      selectedSet.clear();
      paint(searchEl.value);
    };
    wrap.querySelector('[data-act="cancel"]').onclick = () => closePopup();
    wrap.querySelector('[data-act="apply"]').onclick = () => {
      // include checked from current DOM + keep selectedSet in sync
      listEl.querySelectorAll('input[type=checkbox]').forEach((inp) => {
        if (inp.checked) selectedSet.add(inp.value);
        else selectedSet.delete(inp.value);
      });
      onApply(new Set(selectedSet));
      closePopup();
    };
    // live toggle into selectedSet
    listEl.addEventListener('change', (e) => {
      const inp = e.target;
      if (inp?.type !== 'checkbox') return;
      if (inp.checked) selectedSet.add(inp.value);
      else selectedSet.delete(inp.value);
    });

    popupRoot.appendChild(wrap);
  }

  function renderHead() {
    headEl.innerHTML = cols()
      .map((c) => {
        const active = colFilters[c.key] ? ' filtered' : '';
        const sortCls = sortKey === c.key ? (sortDir > 0 ? ' asc' : ' desc') : '';
        return `<th data-key="${c.key}" class="${sortCls}${active}">
          <span class="th-label">${c.label}</span>
          <button type="button" class="th-filter" data-filter="${c.key}" title="Filter ${c.label}">▾</button>
        </th>`;
      })
      .join('');
  }

  function renderBody() {
    const list = sorted(filteredRows());
    const total = allRows.length;
    const shown = list.length;
    countEl.textContent = `Showing ${shown} of ${total}`;
    onCount?.(shown, total, mode);
    bodyEl.innerHTML = list
      .map(
        (r) =>
          `<tr data-id="${r.id}" class="${r.id === selectedId ? 'selected' : ''}${r.class === 'cruise' ? ' row-cruise' : ''}">${cols()
            .map((c) => `<td data-col="${c.key}">${cellHtml(r, c.key)}</td>`)
            .join('')}</tr>`,
      )
      .join('');
  }

  function render() {
    renderHead();
    renderBody();
  }

  headEl.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('[data-filter]');
    if (filterBtn) {
      e.stopPropagation();
      const key = filterBtn.dataset.filter;
      const values = uniqueValues(allRows, key);
      const current = colFilters[key] ? [...colFilters[key]] : values;
      openCheckboxPopup({
        title: `Filter: ${key}`,
        values,
        selected: current,
        anchorEl: filterBtn,
        onApply: (set) => {
          if (set.size === 0 || set.size === values.length) delete colFilters[key];
          else colFilters[key] = set;
          render();
        },
      });
      return;
    }
    const th = e.target.closest('th[data-key]');
    if (!th) return;
    const key = th.dataset.key;
    if (sortKey === key) sortDir *= -1;
    else {
      sortKey = key;
      sortDir = 1;
    }
    render();
  });

  bodyEl.addEventListener('click', (e) => {
    const a = e.target.closest('a.cell-link');
    if (a) {
      e.stopPropagation();
      return;
    }
    const starBtn = e.target.closest('[data-star]');
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    selectedId = tr.dataset.id;
    if (starBtn && onToggleStar) {
      e.stopPropagation();
      const row = allRows.find((r) => r.id === selectedId);
      if (row) onToggleStar(row);
      return;
    }
    renderBody();
    onSelect?.(selectedId);
  });

  bodyEl.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td[data-col="note"], td[data-col="links"]');
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    selectedId = tr.dataset.id;
    const row = allRows.find((r) => r.id === selectedId);
    if (row && onEditNotes) onEditNotes(row, td?.dataset?.col || 'note');
  });

  root.querySelector('#btn-cols').addEventListener('click', (e) => {
    const all = allCols();
    const values = all.map((c) => c.key);
    const labels = Object.fromEntries(all.map((c) => [c.key, c.label]));
    const current = visibleKeys ? [...visibleKeys] : values;
    // show labels in popup by using "label|key" — simpler: show keys with labels as display
    const displayValues = all.map((c) => `${c.label} (${c.key})`);
    const keyOf = (display) => {
      const m = display.match(/\(([^)]+)\)$/);
      return m ? m[1] : display;
    };
    const selectedDisplay = displayValues.filter((d) => current.includes(keyOf(d)));
    openCheckboxPopup({
      title: 'Columns',
      values: displayValues,
      selected: selectedDisplay,
      anchorEl: e.currentTarget,
      onApply: (set) => {
        const keys = [...set].map(keyOf);
        visibleKeys = keys.length ? new Set(keys) : new Set(values);
        render();
      },
    });
  });

  root.querySelector('#btn-clear-filters').addEventListener('click', () => {
    colFilters = {};
    render();
  });

  document.addEventListener('click', (e) => {
    if (!openPopup) return;
    if (e.target.closest('.filter-popup') || e.target.closest('.th-filter') || e.target.closest('#btn-cols')) return;
    closePopup();
  });

  return {
    setData(nextRows, nextMode, keys) {
      allRows = nextRows || [];
      mode = nextMode || 'ship';
      visibleKeys = keys ? new Set(keys) : new Set(allCols().map((c) => c.key));
      colFilters = {};
      sortKey = mode === 'ship' ? 'km' : 'distKm';
      sortDir = 1;
      render();
    },
    select(id) {
      selectedId = id;
      renderBody();
    },
    getRow(id) {
      return allRows.find((r) => r.id === id) || null;
    },
    getVisibleKeys() {
      return visibleKeys ? [...visibleKeys] : allCols().map((c) => c.key);
    },
  };
}

export {
  COLS_SHIP_DEFAULT,
  COLS_SHIP_COMPACT,
};
