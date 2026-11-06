import {
  apiUrl,
  fetchJson,
  isStaticHost,
  loadDataJson,
  loadStaticSailings,
  originSlug,
} from './api.js';

const state = {
  view: 'day',
  ports: [],
  dests: [],
  sailings: [],
  missing: [],
  vessels: [],
  companies: [],
  fetching: false,
  direction: 'both',
  sortCol: 'depart',
  sortDir: 'asc',
  groupVoyages: true,
  vesselsLayout: 'stack', // stack | week
  vesselsAutofit: true,
  smartDisplay: true,
  boardFit: 'scroll', // scroll | shrink
  agendaGroup: 'day', // day | direction
  weekLegOrder: 'out_in', // out_in | by_time
  weekSplit: 'dual', // dual | rows
  vesselsDensity: 'normal', // roomy | normal | tight
  showTripPicker: true,
  syncWeekScroll: true,
  outFrom: '00:00',
  outTo: '23:59',
  inFrom: '00:00',
  inTo: '23:59',
  sidebar: 'left',
  exportFormats: ['csv'],
  tripPicks: { out: null, in: null },
  fieldVisible: {
    time: true,
    duration: true,
    vessel: true,
    operator: true,
    route: true,
    price: true,
  },
  fieldBold: {
    time: true,
    duration: true,
    vessel: true,
    operator: false,
    route: false,
    price: false,
  },
};

const LEG_FIELDS = [
  ['time', 'Time'],
  ['duration', 'Duration'],
  ['vessel', 'Vessel'],
  ['operator', 'Operator'],
  ['route', 'Route'],
  ['price', 'Price'],
];

const RHODES_SATELLITES = ['SKALA KAMIROU(RHO)'];
const pickByKey = new Map();
let pickSeq = 0;

const statusEl = document.getElementById('fh-status');
const progressEl = document.getElementById('fh-progress');
const mainEl = document.getElementById('fh-main');
const originsEl = document.getElementById('fh-origins');
const destsEl = document.getElementById('fh-dests');
const vesselsEl = document.getElementById('fh-vessels');
const companiesEl = document.getElementById('fh-companies');
const dateEl = document.getElementById('fh-date');
const dateEndEl = document.getElementById('fh-date-end');
const directionEl = document.getElementById('fh-direction');
const disruptBtn = document.getElementById('fh-disrupt-btn');
const disruptCountEl = document.getElementById('fh-disrupt-count');
const disruptDlg = document.getElementById('fh-disrupt-dlg');
const disruptDlgTitle = document.getElementById('fh-disrupt-dlg-title');
const disruptDlgMeta = document.getElementById('fh-disrupt-dlg-meta');
const disruptDlgBody = document.getElementById('fh-disrupt-dlg-body');
const disruptRefreshBtn = document.getElementById('fh-disrupt-refresh');
const disruptState = { day: '', items: [], error: '' };
const loadBtn = document.getElementById('fh-load');
const fetchBtn = document.getElementById('fh-fetch');
const locListEl = document.getElementById('loc-list');

let fetchAbort = null;

function setStatus(msg, isError = false) {
  const text = String(msg || '');
  statusEl.textContent = text;
  statusEl.title = text;
  statusEl.classList.toggle('error', isError);
}

function setFetchProgress(done, total) {
  if (!progressEl) return;
  const n = Math.max(1, total | 0);
  const v = Math.max(0, Math.min(done | 0, n));
  progressEl.max = n;
  progressEl.value = v;
  progressEl.hidden = false;
}

function clearFetchProgress() {
  if (!progressEl) return;
  progressEl.hidden = true;
  progressEl.value = 0;
}

function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() {
  return localISO(new Date());
}

function addDaysISO(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localISO(d);
}

function addMonthsISO(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setMonth(d.getMonth() + n);
  return localISO(d);
}

function monthEndISO(iso) {
  const d = new Date(iso + 'T12:00:00');
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return localISO(end);
}

function weekStartISO(iso) {
  const d = new Date(iso + 'T12:00:00');
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day);
  return localISO(d);
}

function daysBetween(from, to) {
  const a = new Date(from + 'T12:00:00');
  const b = new Date(to + 'T12:00:00');
  return Math.max(0, Math.round((b - a) / 86400000));
}

function selectedValues(sel) {
  return [...sel.selectedOptions].map((o) => o.value).filter(Boolean);
}

function itemLabel(it, valueKey, labelFn) {
  if (labelFn) return labelFn(it).toString();
  return (typeof it === 'string' ? it : it[valueKey] || '').toString();
}

function fillSelect(sel, items, { valueKey = 'name', labelFn, selected } = {}) {
  const prev = new Set(selected || selectedValues(sel));
  const sorted = items.slice().sort((a, b) => {
    const va = typeof a === 'string' ? a : a[valueKey];
    const vb = typeof b === 'string' ? b : b[valueKey];
    const aSel = prev.has(va) ? 0 : 1;
    const bSel = prev.has(vb) ? 0 : 1;
    if (aSel !== bSel) return aSel - bSel;
    return itemLabel(a, valueKey, labelFn).localeCompare(itemLabel(b, valueKey, labelFn), undefined, {
      sensitivity: 'base',
    });
  });
  sel.innerHTML = sorted
    .map((it) => {
      const v = typeof it === 'string' ? it : it[valueKey];
      const label = itemLabel(it, valueKey, labelFn);
      const selAttr = prev.has(v) ? ' selected' : '';
      return `<option value="${escapeAttr(v)}"${selAttr}>${escapeHtml(label)}</option>`;
    })
    .join('');
  refilterList(sel);
  updateListSelectionUi(sel);
}

function refilterList(sel) {
  const input = document.getElementById(`${sel.id}-q`);
  const q = (input?.value || '').trim().toLowerCase();
  for (const opt of sel.options) {
    opt.hidden = !!q && !opt.text.toLowerCase().includes(q);
  }
}

function pinSelectedOptions(sel) {
  const opts = [...sel.options];
  const selected = opts.filter((o) => o.selected);
  const rest = opts.filter((o) => !o.selected);
  rest.sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));
  selected.sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));
  for (const o of [...selected, ...rest]) sel.appendChild(o);
}

function updateListSelectionUi(sel) {
  if (!sel) return;
  const n = sel.selectedOptions.length;
  const countEl = document.getElementById(`${sel.id}-count`);
  if (countEl) countEl.textContent = n > 0 ? `(${n})` : '';
  pinSelectedOptions(sel);
  refilterList(sel);
  const first = sel.selectedOptions[0];
  if (first) {
    try {
      // Multi-select: keep first selected near the top of the visible list.
      const idx = [...sel.options].indexOf(first);
      const optH = first.offsetHeight || 18;
      sel.scrollTop = Math.max(0, idx * optH);
    } catch {
      /* ignore */
    }
  } else {
    sel.scrollTop = 0;
  }
}

function bindListClear(sel) {
  const input = document.getElementById(`${sel.id}-q`);
  const btn = document.getElementById(`${sel.id}-x`);
  input?.addEventListener('input', () => refilterList(sel));
  btn?.addEventListener('click', () => {
    if (input) input.value = '';
    for (const opt of sel.options) {
      opt.selected = false;
      opt.hidden = false;
    }
    updateListSelectionUi(sel);
    sel.dispatchEvent(new Event('change'));
  });
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

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep paragraph / list structure as newlines (mirrors ferryhopper.format_disruption_body). */
function formatDisruptionBody(s) {
  let t = String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/p\s*>/gi, '\n');
  t = t.replace(/<\/li\s*>/gi, '\n');
  t = t.replace(/<\/div\s*>/gi, '\n');
  t = t.replace(/<li[^>]*>/gi, '• ');
  t = t.replace(/<p[^>]*>/gi, '');
  t = t.replace(/<[^>]+>/g, '');
  const lines = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map((ln) => ln.trim());
  const out = [];
  for (const ln of lines) {
    if (ln) out.push(ln);
    else if (out.length && out[out.length - 1] !== '') out.push('');
  }
  return out.join('\n').trim();
}

function bodyHtmlFromPlain(body) {
  const lines = String(body || '').split('\n');
  const parts = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    parts.push(`<ul>${list.map((li) => `<li>${escapeHtml(li)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const ln of lines) {
    if (!ln) {
      flushList();
      continue;
    }
    if (/^[•\-\*]\s+/.test(ln)) {
      list.push(ln.replace(/^[•\-\*]\s+/, ''));
    } else {
      flushList();
      parts.push(`<p>${escapeHtml(ln)}</p>`);
    }
  }
  flushList();
  return parts.join('') || `<p class="muted">—</p>`;
}

function sailingKey(r) {
  return [
    r.date || '',
    r.depart || '',
    String(r.vessel || '').toUpperCase(),
    String(r.origin || '').toUpperCase(),
    String(r.dest || '').toUpperCase(),
  ].join('|');
}

function timeToMins(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function inTimeWindow(r) {
  const isIn = (r.direction || 'out') === 'in';
  // Returns: filter by arrival into hub so multi-origin voyages stay together.
  const mins = timeToMins(isIn ? r.arrive || r.depart : r.depart);
  if (mins == null) return true;
  let lo = timeToMins(isIn ? state.inFrom : state.outFrom) ?? 0;
  // 23:59 (or missing) = include through end of day / midnight.
  let hi = timeToMins(isIn ? state.inTo : state.outTo);
  if (hi == null || hi >= 23 * 60 + 59) hi = 24 * 60;
  if (lo > hi) [lo, hi] = [hi, lo];
  return mins >= lo && mins <= hi;
}

function matchesShowDirection(r, dir, hubs) {
  const d = dir || 'both';
  if (d === 'both') return true;
  if (d === 'out') return isLeaving(r, hubs);
  if (d === 'in') return isReturning(r, hubs);
  return true;
}

function filteredSailings() {
  const dests = selectedValues(destsEl);
  const vessels = selectedValues(vesselsEl);
  const companies = selectedValues(companiesEl);
  const tokens = (document.getElementById('fh-q')?.value || '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const hubs = hubNames();
  const showDir = directionEl?.value || state.direction || 'both';
  let rows = state.sailings.slice();
  // Show out/in — apply once so day/agenda/week/month all respect it.
  if (showDir === 'out' || showDir === 'in') {
    rows = rows.filter((r) => matchesShowDirection(r, showDir, hubs));
  }
  if (dests.length) {
    const set = new Set(dests.map((d) => portKey(d)));
    rows = rows.filter((r) => set.has(portKey(r.dest)) || set.has(portKey(r.origin)));
  }
  if (vessels.length) {
    const set = new Set(vessels.map((v) => v.toUpperCase()));
    rows = rows.filter((r) => set.has(String(r.vessel || '').toUpperCase()));
  }
  if (companies.length) {
    const set = new Set(companies.map((c) => c.toUpperCase()));
    rows = rows.filter((r) => set.has(String(r.operator || '').toUpperCase()));
  }
  if (tokens.length) {
    rows = rows.filter((r) => {
      const blob = [r.vessel, r.operator, r.origin, r.dest, r.via, r.depart, r.arrive, r.price]
        .join(' ')
        .toLowerCase();
      return tokens.every((t) => blob.includes(t));
    });
  }
  rows = rows.filter((r) => inTimeWindow(r));
  const col = state.sortCol || 'depart';
  const dir = state.sortDir === 'desc' ? -1 : 1;
  rows = rows.slice().sort((a, b) => {
    const av = String(a[col] ?? '');
    const bv = String(b[col] ?? '');
    if (col === 'duration_min') return dir * ((Number(a.duration_min) || 0) - (Number(b.duration_min) || 0));
    return dir * av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
  });
  return rows;
}

/** Minutes from midnight; if arrive clock is before depart, treat as next day (+24h). */
function clockSortMin(hhmm, departHhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 99999;
  let mins = Number(m[1]) * 60 + Number(m[2]);
  const dm = String(departHhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (dm) {
    const dep = Number(dm[1]) * 60 + Number(dm[2]);
    if (mins < dep) mins += 24 * 60;
  }
  return mins;
}

function legDuration(r) {
  if (r.duration_min != null && r.duration_min !== '' && !Number.isNaN(Number(r.duration_min))) {
    return Number(r.duration_min);
  }
  return clockSortMin(r.arrive, r.depart) - clockSortMin(r.depart, null);
}

function sortLegs(rows) {
  return rows.slice().sort((a, b) => {
    const d = (a.date || '').localeCompare(b.date || '');
    if (d) return d;
    const dep = (a.depart || '').localeCompare(b.depart || '');
    if (dep) return dep;
    const ves = (a.vessel || '').localeCompare(b.vessel || '');
    if (ves) return ves;
    const dur = legDuration(a) - legDuration(b);
    if (dur) return dur;
    return (a.dest || '').localeCompare(b.dest || '');
  });
}

/** Group legs into voyages. Out: date|depart|vessel|origin. In: date|arrive|vessel|dest. */
function groupVoyages(rows) {
  const map = new Map();
  for (const r of rows) {
    const isIn = (r.direction || 'out') === 'in';
    const key = isIn
      ? [r.date || '', r.arrive || '', String(r.vessel || '').toUpperCase(), r.dest || '', 'in'].join('|')
      : [r.date || '', r.depart || '', String(r.vessel || '').toUpperCase(), r.origin || '', 'out'].join('|');
    let v = map.get(key);
    if (!v) {
      v = {
        date: r.date,
        date_display: r.date_display,
        weekday: r.weekday,
        depart: r.depart,
        arrive: r.arrive,
        vessel: r.vessel,
        operator: r.operator,
        origin: r.origin,
        dest: r.dest,
        direction: r.direction || 'out',
        source: r.source || '',
        operator_schedules: r.operator_schedules,
        operator_url: r.operator_url,
        operator_contact: r.operator_contact,
        dests: [],
      };
      map.set(key, v);
    }
    if (isIn && r.arrive) v.arrive = r.arrive;
    // Out: collect dests; return: collect origins (boarding ports).
    const port = isIn ? r.origin || '—' : r.dest || '—';
    const dur = legDuration(r);
    const existing = v.dests.find((d) => d.name === port);
    if (!existing) {
      v.dests.push({
        name: port,
        price: r.price || '',
        arrive: r.arrive || '',
        depart: r.depart || '',
        trip_id: r.trip_id || '',
        book_url: r.book_url || '',
        via: r.via || '',
        duration_min: dur,
      });
    } else {
      if ((dur ?? 99999) < (existing.duration_min ?? 99999)) {
        existing.arrive = r.arrive || existing.arrive;
        existing.depart = r.depart || existing.depart;
        existing.duration_min = dur;
        existing.via = r.via || existing.via;
        existing.trip_id = r.trip_id || existing.trip_id;
        existing.book_url = r.book_url || existing.book_url;
      }
      if (r.price && (!existing.price || existing.price === '—')) existing.price = r.price;
    }
  }
  for (const v of map.values()) {
    const isIn = (v.direction || 'out') === 'in';
    if (isIn) {
      v.dests.sort(
        (a, b) =>
          String(a.depart || '').localeCompare(String(b.depart || '')) || a.name.localeCompare(b.name),
      );
      v.origin = v.dests.map((d) => d.name).join(' - ');
      v.via = '';
      v.slotTime = v.arrive || v.depart || '';
    } else {
      v.dests.sort(
        (a, b) =>
          (a.duration_min ?? 99999) - (b.duration_min ?? 99999) || a.name.localeCompare(b.name),
      );
      v.via = '';
      v.slotTime = v.depart || '';
    }
  }
  // Preserve input order (week out_in vs by_time). Callers time-sort when needed.
  return [...map.values()];
}

function sortLegsByTime(rows) {
  return [...rows].sort(
    (a, b) =>
      String(a.depart || '').localeCompare(String(b.depart || '')) ||
      String(a.arrive || '').localeCompare(String(b.arrive || '')) ||
      String(a.vessel || '').localeCompare(String(b.vessel || '')),
  );
}

/** Fill Via from sibling legs (mirrors Python annotate_itinerary_via). */
function annotateItineraryVia(rows) {
  const groups = new Map();
  for (const r of rows) {
    const isIn = (r.direction || 'out') === 'in';
    const key = isIn
      ? [r.date || '', r.arrive || '', String(r.vessel || '').toUpperCase(), r.dest || '', 'in'].join('|')
      : [r.date || '', r.depart || '', String(r.vessel || '').toUpperCase(), r.origin || '', 'out'].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const group of groups.values()) {
    const isIn = (group[0].direction || 'out') === 'in';
    const ordered = isIn
      ? group.slice().sort((a, b) => String(a.depart || '').localeCompare(String(b.depart || '')))
      : group
          .slice()
          .sort(
            (a, b) =>
              (legDuration(a) ?? 99999) - (legDuration(b) ?? 99999) ||
              String(a.dest || '').localeCompare(String(b.dest || '')),
          );
    const names = ordered.map((x) => (isIn ? x.origin : x.dest) || '');
    ordered.forEach((r, i) => {
      const existing = String(r.via || '').trim();
      if (existing && existing !== '—') return;
      const mids = names.slice(0, i).filter((n) => n && n !== '—');
      r.via = mids.length ? mids.join(', ') : '—';
    });
  }
  return rows;
}

function priceRange(dests) {
  const prices = dests.map((d) => d.price).filter((p) => p && p !== '—');
  if (!prices.length) return '';
  const uniq = [...new Set(prices)];
  if (uniq.length === 1) return uniq[0];
  return `${uniq[0]}–${uniq[uniq.length - 1]}`;
}

function destLine(dests, maxShow = 12) {
  const names = dests.map((d) => d.name).filter(Boolean);
  if (!names.length) return '—';
  if (names.length <= maxShow) return names.join(' → ');
  return `${names.slice(0, maxShow).join(' → ')} +${names.length - maxShow}`;
}

function dirMark(direction) {
  return direction === 'in' ? '←' : '→';
}

const OFFICE_COLS = [
  ['date', 'Date'],
  ['dir', ''],
  ['depart', 'Dep'],
  ['arrive', 'Arr'],
  ['vessel', 'Vessel'],
  ['route', 'Route'],
  ['price', 'Price'],
  ['duration', 'Dur'],
];

function officeRowFromLeg(r) {
  return {
    date: r.date || '',
    dir: dirMark(r.direction),
    depart: r.depart || '',
    arrive: r.arrive || '',
    vessel: r.vessel || '',
    route: itineraryChainRow(r),
    price: r.price && r.price !== '—' ? r.price : '',
    duration: fmtDuration(r),
  };
}

function officeRowFromVoyage(v) {
  const last = (v.dests && v.dests[v.dests.length - 1]) || {};
  const first = (v.dests && v.dests[0]) || {};
  return {
    date: v.date || '',
    dir: dirMark(v.direction),
    depart: v.depart || '',
    arrive: v.arrive || last.arrive || first.arrive || '',
    vessel: v.vessel || '',
    route: itineraryChainVoyage(v, 99),
    price: priceRange(v.dests || []) || (v.price && v.price !== '—' ? v.price : ''),
    duration: voyageDuration(v),
  };
}

function officeTableHtml(officeRows) {
  const th = OFFICE_COLS.map(([k, lab]) => `<th class="${k === 'dir' ? 'dir' : ''}">${escapeHtml(lab)}</th>`).join(
    '',
  );
  let body = '';
  if (!officeRows.length) {
    body = `<tr><td colspan="${OFFICE_COLS.length}">—</td></tr>`;
  } else {
    for (const r of officeRows) {
      const trAttrs = r._pickAttrs
        ? `${r._pickAttrs} title="Double-click to pick for trip"`
        : '';
      body += `<tr${trAttrs ? ` ${trAttrs}` : ''}>${OFFICE_COLS.map(
        ([k]) => `<td class="${k === 'dir' ? 'dir' : ''}">${escapeHtml(String(r[k] ?? ''))}</td>`,
      ).join('')}</tr>`;
    }
  }
  return `<table class="fh-day-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function officeRowWithPick(row, pickSource) {
  const { attrs } = pickMeta(pickSource);
  return { ...row, _pickAttrs: attrs };
}

function officeBucketHtml(bucketRows, { showEmpty } = {}) {
  if (!bucketRows.length) {
    return showEmpty ? `<p class="muted">None in cache — Fetch if needed.</p>` : '';
  }
  if (state.groupVoyages) {
    const voyages = groupVoyages(sortLegsByTime(bucketRows));
    if (!voyages.length) {
      return showEmpty ? `<p class="muted">None in cache — Fetch if needed.</p>` : '';
    }
    const table = officeTableHtml(
      voyages.map((v) => officeRowWithPick(officeRowFromVoyage(v), voyageAsPick(v))),
    );
    const cards = voyages.map((v) => voyageCardHtml(v)).join('');
    return `${table}<div class="fh-day-cards">${cards}</div>`;
  }
  const table = officeTableHtml(
    bucketRows.map((r) => officeRowWithPick(officeRowFromLeg(r), r)),
  );
  const cards = bucketRows
    .map((r) => {
      const { attrs } = pickMeta(r, 'fh-leg-card');
      const block = formatLegBlockHtml(legValsFromRow(r), {
        wrapClass: 'fh-card-body',
        localPill: r.source === 'Local',
      });
      return `<article ${attrs}>${block}<div class="fh-links">${opLinks(r)}${detailsBtn(r)}</div></article>`;
    })
    .join('');
  return `${table}<div class="fh-day-cards">${cards}</div>`;
}

function syncVesselOptions() {
  const names = [...new Set(state.sailings.map((r) => r.vessel).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  state.vessels = names;
  fillSelect(vesselsEl, names, { selected: selectedValues(vesselsEl) });
  const companies = [...new Set(state.sailings.map((r) => r.operator).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  state.companies = companies;
  if (companiesEl) fillSelect(companiesEl, companies, { selected: selectedValues(companiesEl) });
}

function vesselDayPortRows(legs) {
  const mins = (hhmm) => {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return 99999;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const arrAfterDep = (dep, arr) => {
    const depM = mins(dep);
    let arrM = mins(arr);
    if (arrM < 99999 && depM < 99999 && arrM < depM) arrM += 24 * 60;
    return arrM;
  };
  const depBeforeArr = (dep, arr) => {
    const depM = mins(dep);
    const arrM = mins(arr);
    if (depM < 99999 && arrM < 99999 && depM > arrM) return depM - 24 * 60;
    return depM;
  };
  const turnaroundOk = (outArr, retDep) => {
    const am = mins(outArr);
    const dm = mins(retDep);
    if (am >= 99999 || dm >= 99999) return true;
    return dm >= am;
  };
  const outGroups = new Map();
  const inGroups = new Map();
  for (const r of legs) {
    const origin = (r.origin || '').trim() || '—';
    const dest = (r.dest || '').trim() || '—';
    const dep = (r.depart || r.dep || '').trim();
    const arr = (r.arrive || r.arr || '').trim();
    const direction = String(r.direction || '').toLowerCase();
    if (direction === 'in') {
      const key = `${dest}\0${arr}`;
      if (!inGroups.has(key)) inGroups.set(key, { dest, arr, origins: [] });
      inGroups.get(key).origins.push({ origin, dep });
    } else {
      const key = `${origin}\0${dep}`;
      if (!outGroups.has(key)) outGroups.set(key, { origin, dep, dests: [] });
      outGroups.get(key).dests.push({ dest, arr });
    }
  }
  const usedIn = new Set();
  const trips = [];
  const outOrdered = [...outGroups.values()].sort(
    (a, b) =>
      mins(a.dep) - mins(b.dep) ||
      Math.min(...a.dests.map((d) => arrAfterDep(a.dep, d.arr))) -
        Math.min(...b.dests.map((d) => arrAfterDep(b.dep, d.arr))),
  );
  for (const g of outOrdered) {
    g.dests.sort((a, b) => arrAfterDep(g.dep, a.arr) - arrAfterDep(g.dep, b.arr));
    const outPorts = g.dests.map((d) => d.dest);
    const arrByPort = Object.fromEntries(g.dests.map((d) => [d.dest, d.arr]));
    let best = null;
    for (const ig of inGroups.values()) {
      const ik = `${ig.dest}\0${ig.arr}`;
      if (ig.dest !== g.origin || usedIn.has(ik)) continue;
      const byPort = Object.fromEntries(ig.origins.map((o) => [o.origin, o.dep]));
      let turnaround = null;
      for (const p of outPorts) {
        if (byPort[p] != null) turnaround = p;
      }
      if (!turnaround) continue;
      const taDep = byPort[turnaround];
      const outArr = arrByPort[turnaround] || '';
      if (!turnaroundOk(outArr, taDep)) continue;
      let layover = mins(taDep) - mins(outArr);
      if (layover < 0) layover += 24 * 60;
      if (!best || layover < best.layover) {
        best = { layover, ik, ig, turnaround, taDep };
      }
    }
    if (best) {
      usedIn.add(best.ik);
      trips.push({
        start: mins(g.dep),
        kind: 'round',
        origin: g.origin,
        dep: g.dep,
        dests: g.dests,
        turnaround: best.turnaround,
        taDep: best.taDep,
        origins: best.ig.origins,
        inDest: best.ig.dest,
        inArr: best.ig.arr,
      });
    } else {
      trips.push({ start: mins(g.dep), kind: 'out', origin: g.origin, dep: g.dep, dests: g.dests });
    }
  }
  for (const ig of inGroups.values()) {
    const ik = `${ig.dest}\0${ig.arr}`;
    if (usedIn.has(ik)) continue;
    const start = Math.min(...ig.origins.map((o) => depBeforeArr(o.dep, ig.arr)));
    trips.push({ start, kind: 'in', dest: ig.dest, arr: ig.arr, origins: ig.origins });
  }
  trips.sort((a, b) => a.start - b.start || (a.kind === 'in' ? 0 : 1) - (b.kind === 'in' ? 0 : 1));

  const stops = [];
  const emitOrigin = (port, dep) => {
    const last = stops[stops.length - 1];
    if (last && last.port === port && !last.departure) {
      if (last.arrival && !turnaroundOk(last.arrival, dep)) {
        stops.push({ port, arrival: '', departure: dep });
      } else last.departure = dep;
    } else if (!(last && last.port === port && last.departure === dep)) {
      stops.push({ port, arrival: '', departure: dep });
    }
  };
  for (const t of trips) {
    if (t.kind === 'out') {
      emitOrigin(t.origin, t.dep);
      for (const d of t.dests) stops.push({ port: d.dest, arrival: d.arr, departure: '' });
    } else if (t.kind === 'in') {
      for (const o of [...t.origins].sort((a, b) => depBeforeArr(a.dep, t.arr) - depBeforeArr(b.dep, t.arr))) {
        emitOrigin(o.origin, o.dep);
      }
      stops.push({ port: t.dest, arrival: t.arr, departure: '' });
    } else {
      emitOrigin(t.origin, t.dep);
      for (const d of t.dests) stops.push({ port: d.dest, arrival: d.arr, departure: '' });
      for (let i = stops.length - 1; i >= 0; i--) {
        if (stops[i].port === t.turnaround && !stops[i].departure) {
          stops[i].departure = t.taDep;
          break;
        }
      }
      const taKey = depBeforeArr(t.taDep, t.inArr);
      const retCalls = t.origins
        .filter((o) => o.origin !== t.turnaround && depBeforeArr(o.dep, t.inArr) >= taKey)
        .map((o) => [o.origin, o.dep])
        .sort((a, b) => depBeforeArr(a[1], t.inArr) - depBeforeArr(b[1], t.inArr));
      for (const [port, rdep] of retCalls) stops.push({ port, arrival: '', departure: rdep });
      stops.push({ port: t.inDest, arrival: t.inArr, departure: '' });
    }
  }
  return stops;
}

function vesselBlockHtml(vessel, legs) {
  const ports = vesselDayPortRows(legs);
  let html = `<div class="fh-vessel-block"><div class="fh-vessel-head"><h4>${escapeHtml(vessel)}</h4></div>
    <table class="fh-vessel-table"><thead><tr><th>Port</th><th>Arrival</th><th>Departure</th></tr></thead><tbody>`;
  for (const p of ports) {
    html += `<tr><td>${escapeHtml(p.port)}</td><td>${escapeHtml(p.arrival || '—')}</td><td>${escapeHtml(p.departure || '—')}</td></tr>`;
  }
  html += '</tbody></table></div>';
  return html;
}

function vesselWeeksFromRows(rows) {
  const byDay = new Map();
  for (const r of rows) {
    const day = r.date || '—';
    if (!byDay.has(day)) byDay.set(day, new Map());
    const byVessel = byDay.get(day);
    const vessel = r.vessel || '—';
    if (!byVessel.has(vessel)) byVessel.set(vessel, []);
    byVessel.get(vessel).push(r);
  }
  const isoDays = [...byDay.keys()].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!isoDays.length) return [];
  const first = new Date(isoDays[0] + 'T12:00:00');
  const last = new Date(isoDays[isoDays.length - 1] + 'T12:00:00');
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // Monday
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7))); // Sunday
  const weeks = [];
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 7)) {
    const weekStart = new Date(cur);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const iso = localISO(d);
      const byVessel = byDay.get(iso) || new Map();
      days.push({
        day: iso,
        label: `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]} ${d.getDate()}`,
        byVessel,
      });
    }
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weeks.push({
      title: `Week ${localISO(weekStart)} → ${localISO(weekEnd)}`,
      days,
    });
  }
  return weeks;
}

function renderVessels(rows) {
  if (!rows.length) return '<p class="muted">No sailings.</p>';
  const autofit = state.vesselsAutofit !== false;
  const dens =
    state.vesselsDensity === 'roomy' || state.vesselsDensity === 'tight'
      ? state.vesselsDensity
      : 'normal';
  const wrapClass = `fh-vessels-view fh-vessels-den-${dens}${autofit ? ' fh-vessels-autofit' : ' fh-vessels-stretch'}`;
  if (state.vesselsLayout === 'week') {
    const weeks = vesselWeeksFromRows(rows);
    if (!weeks.length) return '<p class="muted">No sailings.</p>';
    let html = `<div class="${wrapClass} fh-vessels-week-mode">`;
    for (const week of weeks) {
      html += `<section class="fh-vessel-week"><h3 class="fh-day-head">${escapeHtml(week.title)}</h3><div class="fh-vessel-week-grid">`;
      for (const day of week.days) {
        html += `<div class="fh-vessel-week-col"><h4 class="fh-vessel-week-h">${escapeHtml(day.label)}</h4>`;
        const vessels = [...day.byVessel.keys()].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        );
        if (!vessels.length) html += '<p class="muted">—</p>';
        for (const vessel of vessels) html += vesselBlockHtml(vessel, day.byVessel.get(vessel));
        html += '</div>';
      }
      html += '</div></section>';
    }
    html += '</div>';
    return html;
  }
  const byDay = new Map();
  for (const r of rows) {
    const day = r.date || '—';
    if (!byDay.has(day)) byDay.set(day, new Map());
    const byVessel = byDay.get(day);
    const vessel = r.vessel || '—';
    if (!byVessel.has(vessel)) byVessel.set(vessel, []);
    byVessel.get(vessel).push(r);
  }
  let html = `<div class="${wrapClass}">`;
  for (const [day, byVessel] of [...byDay.entries()].sort()) {
    html += `<section class="fh-vessel-day"><h3 class="fh-day-head">${escapeHtml(dayTitle(day) || day)}</h3>`;
    html += '<div class="fh-vessel-day-cards">';
    for (const vessel of [...byVessel.keys()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )) {
      html += vesselBlockHtml(vessel, byVessel.get(vessel));
    }
    html += '</div></section>';
  }
  html += '</div>';
  return html;
}

function setFetchUi(running) {
  state.fetching = running;
  if (loadBtn) loadBtn.disabled = running;
  fetchBtn.textContent = running ? 'Stop' : 'Fetch';
  if (!running) {
    fetchAbort = null;
    clearFetchProgress();
  }
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  applySmartDisplay();
}

function applyBoardFit() {
  const fit = state.boardFit === 'shrink' ? 'shrink' : 'scroll';
  document.body.classList.remove('fh-board-fit-scroll', 'fh-board-fit-shrink');
  document.body.classList.add(`fh-board-fit-${fit}`);
  const el = document.getElementById('fh-board-fit');
  if (el && el.value !== fit) el.value = fit;
}

function applySmartDisplay() {
  const v = state.view || 'day';
  const smart = state.smartDisplay !== false;
  const show = {
    smart: true,
    group: !smart || ['day', 'agenda', 'week', 'month'].includes(v),
    font: true,
    fields: !smart || v === 'week' || v === 'month',
    agenda: !smart || v === 'agenda',
    week: !smart || v === 'week' || v === 'month',
    'week-split': !smart || v === 'week',
    vessels: !smart || v === 'vessels',
    'board-fit': !smart || v === 'week' || v === 'month' || v === 'vessels',
    trip: !smart || v === 'day' || v === 'agenda',
  };
  // Class + hidden: `.fh-check`/`.fh-filter-field { display:flex }` beats bare [hidden].
  document.querySelectorAll('[data-display]').forEach((el) => {
    const key = el.getAttribute('data-display');
    const on = !!(show[key] ?? true);
    el.hidden = !on;
    el.classList.toggle('fh-display-off', !on);
  });
}

/** Adjust date range for view; quiet cache reload if range grew. */
function applyViewOnly(view) {
  const prevTo = dateEndEl.value;
  setView(view);
  const from = dateEl.value || todayISO();
  if (view === 'week') {
    const start = weekStartISO(from);
    dateEl.value = start;
    dateEndEl.value = addDaysISO(start, 6);
  } else if (view === 'month') {
    const start = `${from.slice(0, 8)}01`;
    dateEl.value = start;
    dateEndEl.value = monthEndISO(start);
  }
  if (dateEndEl.value && dateEndEl.value !== prevTo) {
    loadSailings({ quiet: true });
  } else {
    render();
  }
}

const PORT_ALIAS = {
  RHODES: 'RODOS',
  RHODOS: 'RODOS',
  RODOS: 'RODOS',
  'SKALA KAMIROU(RHO)': 'SKALA KAMIROU(RHO)',
  'SKALA KAMIROU': 'SKALA KAMIROU(RHO)',
  'KAMIROS SKALA': 'SKALA KAMIROU(RHO)',
  'KAMEIROS SKALA': 'SKALA KAMIROU(RHO)',
};

function portKey(name) {
  const u = String(name || '').toUpperCase().trim();
  return PORT_ALIAS[u] || u;
}

function hubNames() {
  return selectedValues(originsEl).length ? selectedValues(originsEl) : ['Rhodes'];
}

function hubKeySet(hubs) {
  const set = new Set();
  for (const h of hubs) {
    const k = portKey(h);
    set.add(k);
    if (k === 'RODOS') {
      for (const s of RHODES_SATELLITES) set.add(portKey(s));
    }
  }
  return set;
}

function isLeaving(r, hubs) {
  return hubKeySet(hubs).has(portKey(r.origin));
}

function isReturning(r, hubs) {
  return hubKeySet(hubs).has(portKey(r.dest));
}

function applySidebar(pos) {
  const p = pos === 'right' ? 'right' : 'left';
  state.sidebar = p;
  document.body.classList.remove('fh-sidebar-top', 'fh-sidebar-left', 'fh-sidebar-right');
  document.body.classList.add(`fh-sidebar-${p}`);
  document.querySelectorAll('[data-sidebar]').forEach((b) => {
    b.classList.toggle('active', b.dataset.sidebar === p);
  });
}

async function loadPorts() {
  let data;
  if (isStaticHost()) {
    data = await loadDataJson('ferryhopper_ports.json');
  } else {
    try {
      data = await fetchJson(apiUrl('api/ferryhopper/ports'));
    } catch {
      data = await loadDataJson('ferryhopper_ports.json');
    }
  }
  state.ports = data.ports || [];
  state.ports.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  let prefs = {};
  try {
    if (!isStaticHost()) {
      prefs = await fetchJson(apiUrl('api/ferryhopper/prefs'));
    }
  } catch {
    /* ignore */
  }
  try {
    const local = JSON.parse(localStorage.getItem('fh_prefs') || '{}');
    prefs = { ...prefs, ...local };
  } catch {
    /* ignore */
  }
  const selected = prefs.origins?.length ? prefs.origins : ['Rhodes'];
  if (prefs.direction) {
    state.direction = prefs.direction;
    directionEl.value = prefs.direction;
  }
  state.groupVoyages = prefs.group_voyages !== false;
  const groupEl = document.getElementById('fh-group');
  if (groupEl) groupEl.checked = state.groupVoyages;
  state.vesselsLayout = prefs.vessels_layout === 'week' ? 'week' : 'stack';
  state.vesselsAutofit = prefs.vessels_autofit !== false;
  state.vesselsDensity =
    prefs.vessels_density === 'roomy' || prefs.vessels_density === 'tight'
      ? prefs.vessels_density
      : 'normal';
  state.smartDisplay = prefs.smart_display !== false;
  state.boardFit = prefs.board_fit === 'shrink' ? 'shrink' : 'scroll';
  state.agendaGroup = prefs.agenda_group === 'direction' ? 'direction' : 'day';
  state.weekLegOrder = prefs.week_leg_order === 'by_time' ? 'by_time' : 'out_in';
  state.weekSplit = prefs.week_split === 'rows' ? 'rows' : 'dual';
  state.showTripPicker = prefs.show_trip_picker !== false;
  const fromPref = String(prefs.board_from || '').trim();
  const toPref = String(prefs.board_to || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromPref)) dateEl.value = fromPref;
  else if (!dateEl.value) dateEl.value = todayISO();
  if (/^\d{4}-\d{2}-\d{2}$/.test(toPref)) dateEndEl.value = toPref;
  else if (toPref === '') {
    /* keep empty To = view-derived range */
  }
  const vlEl = document.getElementById('fh-vessels-layout');
  if (vlEl) vlEl.value = state.vesselsLayout;
  const vaEl = document.getElementById('fh-vessels-autofit');
  if (vaEl) vaEl.checked = state.vesselsAutofit;
  const vdEl = document.getElementById('fh-vessels-density');
  if (vdEl) vdEl.value = state.vesselsDensity || 'normal';
  const sdEl = document.getElementById('fh-smart-display');
  if (sdEl) sdEl.checked = state.smartDisplay;
  const bfEl = document.getElementById('fh-board-fit');
  if (bfEl) bfEl.value = state.boardFit;
  applyBoardFit();
  const agEl = document.getElementById('fh-agenda-group');
  if (agEl) agEl.value = state.agendaGroup;
  const wloEl = document.getElementById('fh-week-leg-order');
  if (wloEl) wloEl.value = state.weekLegOrder;
  const wsEl = document.getElementById('fh-week-split');
  if (wsEl) wsEl.value = state.weekSplit;
  const stpEl = document.getElementById('fh-show-trip-picker');
  if (stpEl) stpEl.checked = state.showTripPicker;
  applySmartDisplay();
  applySidebar(prefs.sidebar === 'right' ? 'right' : 'left');
  if (Array.isArray(prefs.export_formats) && prefs.export_formats.length) {
    state.exportFormats = prefs.export_formats.filter((x) => ['csv', 'tsv', 'md', 'html'].includes(x));
    try {
      localStorage.setItem('fh_export_formats', JSON.stringify(state.exportFormats));
    } catch {
      /* ignore */
    }
  } else {
    state.exportFormats = savedExportFormats();
  }
  const names = state.ports.map((p) => p.name);
  for (const o of selected) {
    if (o && !names.includes(o)) state.ports.unshift({ name: o, code: '', country: 'Greece' });
  }
  if (!state.ports.length) {
    state.ports = [
      { name: 'Rhodes', code: 'RHO', country: 'Greece' },
      { name: 'Piraeus', code: 'PIR', country: 'Greece' },
    ];
  }
  fillSelect(originsEl, state.ports, {
    labelFn: (p) => (p.code ? `${p.name} (${p.code})` : p.name),
    selected,
  });
  localStorage.setItem('fh_prefs', JSON.stringify(prefs));
}

async function loadConnections() {
  const origins = selectedValues(originsEl);
  if (!origins.length) {
    fillSelect(destsEl, []);
    return;
  }
  const all = [];
  const seen = new Set();
  for (const origin of origins) {
    try {
      let data;
      if (isStaticHost()) {
        data = await loadDataJson(`ferryhopper_conn_${originSlug(origin)}.json`);
      } else {
        try {
          data = await fetchJson(
            apiUrl(`api/ferryhopper/connections?origin=${encodeURIComponent(origin)}`),
          );
        } catch {
          data = await loadDataJson(`ferryhopper_conn_${originSlug(origin)}.json`);
        }
      }
      for (const d of data.destinations || []) {
        if (seen.has(d.name)) continue;
        seen.add(d.name);
        all.push(d);
      }
    } catch {
      /* skip */
    }
  }
  state.dests = all;
  const prefs = JSON.parse(localStorage.getItem('fh_prefs') || '{}');
  fillSelect(destsEl, all, {
    labelFn: (d) => (d.code ? `${d.name} (${d.code})` : d.name),
    selected: prefs.dests || [],
  });
}

function extractDisruptionItems(payload) {
  let root = payload;
  if (root && typeof root === 'object' && root.data != null) root = root.data;
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root);
    } catch {
      const body = formatDisruptionBody(root) || stripHtml(root);
      return body ? [{ title: 'Disruption', body }] : [];
    }
  }
  if (!root || typeof root !== 'object') return [];
  let list = root.disruptions || root.items || root.alerts;
  if (!list && Array.isArray(root)) list = root;
  if (!Array.isArray(list)) return [];
  return list
    .map((it) => {
      if (typeof it === 'string') {
        const body = formatDisruptionBody(it) || stripHtml(it);
        return { title: 'Disruption', body };
      }
      const raw = it.content || it.description || it.message || '';
      return {
        title: stripHtml(it.title || it.type || 'Disruption'),
        body: formatDisruptionBody(raw) || stripHtml(raw),
      };
    })
    .filter((it) => it.title || it.body);
}

function renderDisruptDialog() {
  const day = disruptState.day || '';
  if (disruptDlgTitle) disruptDlgTitle.textContent = `Disruptions — ${day}`;
  if (disruptDlgMeta) {
    disruptDlgMeta.textContent = day
      ? `Ferryhopper alerts for ${day} (From / range start · country GR)`
      : '';
  }
  if (!disruptDlgBody) return;
  if (disruptState.error) {
    disruptDlgBody.innerHTML = `<p class="muted">Unavailable: ${escapeHtml(disruptState.error)}</p>`;
    return;
  }
  const items = disruptState.items || [];
  if (!items.length) {
    disruptDlgBody.innerHTML = '<p class="muted">None reported for this date.</p>';
    return;
  }
  disruptDlgBody.innerHTML = items
    .map(
      (it) =>
        `<article class="fh-disrupt-card"><h3>${escapeHtml(it.title || 'Disruption')}</h3>${bodyHtmlFromPlain(
          it.body || '',
        )}</article>`,
    )
    .join('');
}

function applyDisruptBadge() {
  const n = (disruptState.items || []).length;
  if (disruptCountEl) disruptCountEl.textContent = disruptState.error ? '!' : String(n);
  if (disruptBtn) {
    disruptBtn.classList.toggle('has-alerts', n > 0);
    disruptBtn.classList.toggle('is-error', !!disruptState.error);
    disruptBtn.title = disruptState.day
      ? `Alerts for ${disruptState.day}${n ? ` · ${n}` : ''}`
      : 'Disruptions';
  }
}

async function loadDisruptions(day, { refresh = false } = {}) {
  disruptState.day = day;
  const q = new URLSearchParams({ date: day });
  if (refresh) q.set('refresh', '1');
  if (refresh && disruptCountEl) disruptCountEl.textContent = '…';
  if (refresh && disruptRefreshBtn) disruptRefreshBtn.disabled = true;
  try {
    let data;
    if (isStaticHost()) {
      data = await loadDataJson(`ferryhopper_disruptions_GR_${day}.json`);
    } else {
      try {
        data = await fetchJson(apiUrl(`api/ferryhopper/disruptions?${q}`));
      } catch {
        data = await loadDataJson(`ferryhopper_disruptions_GR_${day}.json`);
      }
    }
    disruptState.items = extractDisruptionItems(data);
    disruptState.error = '';
  } catch (e) {
    disruptState.items = [];
    disruptState.error = isStaticHost() ? '' : String(e.message || e);
  } finally {
    if (disruptRefreshBtn) disruptRefreshBtn.disabled = false;
    applyDisruptBadge();
    if (disruptDlg?.open) renderDisruptDialog();
  }
}

disruptBtn?.addEventListener('click', () => {
  renderDisruptDialog();
  disruptDlg?.showModal();
});

disruptRefreshBtn?.addEventListener('click', () => {
  const day = disruptState.day || dateEl.value || todayISO();
  loadDisruptions(day, { refresh: true });
});

function rangeParams() {
  const originList = selectedValues(originsEl);
  const origins = originList.join(',') || 'Rhodes';
  const dests = selectedValues(destsEl).join(',');
  let from = dateEl.value || todayISO();
  let to = dateEndEl.value || '';
  // Week always loads Mon–Sun of the selected week (not mid-week → +6).
  if (state.view === 'week') {
    from = weekStartISO(from);
    to = addDaysISO(from, 6);
  } else if (state.view === 'month') {
    from = `${from.slice(0, 8)}01`;
    to = monthEndISO(from);
  } else if (!to) {
    to = from;
  }
  const direction = directionEl.value || state.direction || 'both';
  state.direction = direction;
  const q = new URLSearchParams({ origins, from, direction });
  if (to) q.set('to', to);
  if (dests) q.set('dests', dests);
  return { q, from, to, origins, originList: originList.length ? originList : ['Rhodes'], dests, direction };
}

function originDayUnits() {
  const { from, to, originList, direction } = rangeParams();
  const end = to || from;
  const n = daysBetween(from, end) + 1;
  // One unit per origin-day; direction "both" stays both (leave+return in one server call).
  const dir = direction === 'in' ? 'in' : direction === 'out' ? 'out' : 'both';
  const units = [];
  for (const origin of originList) {
    for (let i = 0; i < n; i++) {
      units.push({ origin, day: addDaysISO(from, i), direction: dir });
    }
  }
  return units;
}

async function loadSailings({ signal, quiet = false } = {}) {
  const { q, from, to, originList, direction } = rangeParams();
  if (!quiet) {
    // Persist From/To (and other prefs) whenever the user loads a range.
    try {
      await savePrefs();
    } catch {
      /* ignore */
    }
    setStatus('Loading cache…');
  }
  try {
    let data;
    if (isStaticHost()) {
      data = await loadStaticSailings({
        origins: originList,
        from,
        to: to || from,
        direction,
      });
    } else {
      try {
        data = await fetchJson(apiUrl(`api/ferryhopper/sailings?${q}`), { signal });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        data = await loadStaticSailings({
          origins: originList,
          from,
          to: to || from,
          direction,
        });
      }
    }
    state.sailings = annotateItineraryVia((data.sailings || []).map((r) => ({ ...r })));
    state.missing = data.missing || [];
    syncVesselOptions();
    const miss = state.missing.length
      ? isStaticHost()
        ? ` · ${state.missing.length} day files not in published cache`
        : ` · missing ${state.missing.length} day-direction cache files (Fetch fills them)`
      : '';
    const nIn = state.sailings.filter((r) => r.direction === 'in').length;
    const nOut = state.sailings.filter((r) => (r.direction || 'out') !== 'in').length;
    const dirHint =
      !isStaticHost() &&
      state.direction !== 'out' &&
      nIn === 0 &&
      state.missing.some((m) => String(m).endsWith('|in'))
        ? ' · no returns yet — Fetch with Leaving+returning'
        : '';
    const mode = data.static || isStaticHost() ? ' · cached (static)' : '';
    setStatus(
      `${state.sailings.length} legs (${nOut} leave / ${nIn} return) · ${groupVoyages(state.sailings).length} voyages${miss}${dirHint}${mode}`,
    );
    if (!quiet) await loadDisruptions(from);
    render();
    if (!quiet) {
      await savePrefs();
      if (!isStaticHost()) {
        await refreshLocalList();
        syncLocalDatalists();
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    setStatus(String(e.message || e), true);
  }
}

async function fetchOneUnit(unit, dests, signal) {
  const skip = document.getElementById('fh-skip')?.checked;
  const q = new URLSearchParams({
    origins: unit.origin,
    from: unit.day,
    to: unit.day,
    refresh: '1',
    direction: unit.direction,
  });
  if (skip) q.set('skip_cached', '1');
  if (dests) q.set('dests', dests);
  const res = await fetch(apiUrl(`api/ferryhopper/sailings?${q}`), { cache: 'no-store', signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function runSequentialFetch() {
  if (state.fetching) {
    fetchAbort?.abort();
    setFetchUi(false);
    setStatus('Fetch stopped — Skip cached + Fetch resumes');
    return;
  }
  const skip = document.getElementById('fh-skip')?.checked;
  if (
    !confirm(
      skip
        ? 'Fetch missing hub days from Ferryhopper MCP? (Skip cached is on.)'
        : 'Fetch from Ferryhopper MCP and overwrite this date range?',
    )
  ) {
    return;
  }

  const units = originDayUnits();
  const dests = selectedValues(destsEl).join(',');
  fetchAbort = new AbortController();
  const { signal } = fetchAbort;
  setFetchUi(true);
  setFetchProgress(0, units.length);

  let done = 0;
  const t0 = Date.now();
  const pool = 8;

  async function runUnit(unit) {
    const arrow = unit.direction === 'in' ? '←' : unit.direction === 'out' ? '→' : '↔';
    setStatus(`Fetching ${unit.origin} ${arrow} · ${unit.day} · ${done + 1}/${units.length}…`);
    await fetchOneUnit(unit, dests, signal);
    done += 1;
    setFetchProgress(done, units.length);
    const sec = Math.round((Date.now() - t0) / 1000);
    setStatus(
      `Fetched ${unit.origin} ${arrow} · ${unit.day} · ${done}/${units.length}` +
        (done < units.length ? ` · ${sec}s — continuing…` : ` · ${sec}s`),
    );
  }

  try {
    for (let i = 0; i < units.length; i += pool) {
      if (signal.aborted) break;
      const batch = units.slice(i, i + pool);
      await Promise.all(batch.map((u) => runUnit(u)));
      await loadSailings({ signal, quiet: true });
    }
    if (!signal.aborted) {
      await loadSailings();
      const sec = Math.round((Date.now() - t0) / 1000);
      const nVoy = state.groupVoyages
        ? groupVoyages(filteredSailings()).length
        : filteredSailings().length;
      setStatus(
        `Fetch complete · ${done}/${units.length} days · ${sec}s · ${state.sailings.length} legs · ${nVoy} ${state.groupVoyages ? 'voyages' : 'legs shown'}`,
      );
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      setStatus(`Fetch stopped · ${done}/${units.length} days done · Skip cached + Fetch resumes`);
    } else {
      setStatus(String(e.message || e), true);
      try {
        await loadSailings();
      } catch {
        /* ignore */
      }
    }
  } finally {
    setFetchUi(false);
  }
}

async function clearCacheSlice() {
  const { from, to, originList, direction } = rangeParams();
  const end = to || from;
  if (
    !confirm(
      `Clear Ferryhopper day cache for ${originList.join(', ')} (+Kamiros if Rhodes)\n${from} → ${end}\nShow=${direction}?`,
    )
  ) {
    return;
  }
  try {
    const res = await fetch(apiUrl('api/ferryhopper/cache'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origins: originList,
        from,
        to: end,
        direction,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    setStatus(`Cleared ${data.deleted || 0} files · Load or Fetch`);
    await loadSailings();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function savePrefs() {
  const body = {
    origins: selectedValues(originsEl),
    dests: selectedValues(destsEl),
    vessels: selectedValues(vesselsEl),
    direction: directionEl.value || 'both',
    group_voyages: state.groupVoyages,
    vessels_layout: state.vesselsLayout || 'stack',
    vessels_autofit: state.vesselsAutofit !== false,
    vessels_density:
      state.vesselsDensity === 'roomy' || state.vesselsDensity === 'tight'
        ? state.vesselsDensity
        : 'normal',
    smart_display: state.smartDisplay !== false,
    board_fit: state.boardFit === 'shrink' ? 'shrink' : 'scroll',
    agenda_group: state.agendaGroup === 'direction' ? 'direction' : 'day',
    week_leg_order: state.weekLegOrder === 'by_time' ? 'by_time' : 'out_in',
    week_split: state.weekSplit === 'rows' ? 'rows' : 'dual',
    show_trip_picker: state.showTripPicker !== false,
    sidebar: state.sidebar || 'left',
    export_formats: state.exportFormats || savedExportFormats(),
    board_from: dateEl.value || todayISO(),
    board_to: dateEndEl.value || '',
  };
  localStorage.setItem('fh_prefs', JSON.stringify(body));
  if (isStaticHost()) return;
  try {
    await fetch(apiUrl('api/ferryhopper/prefs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* ignore */
  }
}

function applyStaticUi() {
  if (!isStaticHost()) return;
  document.body.classList.add('fh-static');
  for (const id of [
    'fh-fetch',
    'fh-skip',
    'fh-clear-cache',
    'fh-clear-all-cache',
    'fh-local-open',
    'loc-new',
    'loc-add',
  ]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.disabled = true;
    el.hidden = true;
  }
  document.getElementById('fh-skip')?.closest('label')?.setAttribute('hidden', '');
  document.getElementById('fh-cache-menu')?.setAttribute('hidden', '');
  document.getElementById('loc-list')?.closest('details')?.setAttribute('hidden', '');
  document.getElementById('loc-list')?.parentElement?.setAttribute('hidden', '');
}

async function clearAllSailingCache() {
  if (
    !confirm(
      'Delete ALL Ferryhopper sailing day caches (every hub / date)?\nDisruptions / connections caches are left alone.',
    )
  ) {
    return;
  }
  try {
    const res = await fetch(apiUrl('api/ferryhopper/cache'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    setStatus(`Cleared ${data.deleted || 0} sailing cache files · Load or Fetch`);
    await loadSailings();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

function locFormBody() {
  const weekdays = [...document.querySelectorAll('input[name="loc-wd"]:checked')].map((el) => el.value);
  const oneDate = document.getElementById('loc-date').value || '';
  const dur = document.getElementById('loc-duration')?.value || '';
  return {
    id: document.getElementById('loc-id')?.value || '',
    vessel: document.getElementById('loc-vessel').value,
    operator: document.getElementById('loc-operator').value,
    origin: document.getElementById('loc-origin').value,
    dest: document.getElementById('loc-dest').value,
    depart: document.getElementById('loc-depart').value,
    arrive: document.getElementById('loc-arrive').value,
    duration_min: dur ? Number(dur) : null,
    via: document.getElementById('loc-via').value,
    price: document.getElementById('loc-price').value,
    contact: document.getElementById('loc-contact')?.value || '',
    book_url: document.getElementById('loc-book')?.value || '',
    notes: document.getElementById('loc-notes')?.value || '',
    date: oneDate || null,
    weekdays: weekdays.length ? weekdays : null,
    direction: document.getElementById('loc-direction').value,
    active: document.getElementById('loc-active')?.checked !== false,
  };
}

function clearLocForm() {
  const idEl = document.getElementById('loc-id');
  if (idEl) idEl.value = '';
  for (const id of [
    'loc-vessel',
    'loc-operator',
    'loc-dest',
    'loc-via',
    'loc-price',
    'loc-arrive',
    'loc-duration',
    'loc-contact',
    'loc-book',
    'loc-notes',
  ]) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
  const origin = document.getElementById('loc-origin');
  if (origin) origin.value = selectedValues(originsEl)[0] || 'Rhodes';
  const date = document.getElementById('loc-date');
  if (date) date.value = dateEl.value || '';
  const dep = document.getElementById('loc-depart');
  if (dep) dep.value = '09:00';
  const dir = document.getElementById('loc-direction');
  if (dir) dir.value = 'out';
  const act = document.getElementById('loc-active');
  if (act) act.checked = true;
  document.querySelectorAll('input[name="loc-wd"]').forEach((el) => {
    el.checked = false;
  });
  const title = document.querySelector('#fh-local-dlg h2');
  if (title) title.textContent = 'Local / tour sailing';
}

function fillLocForm(r) {
  clearLocForm();
  const idEl = document.getElementById('loc-id');
  if (idEl) idEl.value = r.id || '';
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val == null ? '' : String(val);
  };
  set('loc-vessel', r.vessel);
  set('loc-operator', r.operator);
  set('loc-origin', r.origin);
  set('loc-dest', r.dest);
  set('loc-via', Array.isArray(r.via) ? r.via.join(', ') : r.via);
  set('loc-price', r.price);
  set('loc-date', r.date || '');
  set('loc-depart', r.depart);
  set('loc-arrive', r.arrive === '—' ? '' : r.arrive);
  set('loc-duration', r.duration_min ?? '');
  set('loc-contact', r.contact || '');
  set('loc-book', r.book_url || '');
  set('loc-notes', r.notes || '');
  const dir = document.getElementById('loc-direction');
  if (dir) dir.value = r.direction || 'out';
  const act = document.getElementById('loc-active');
  if (act) act.checked = r.active !== false;
  const wds = new Set((r.weekdays || []).map((w) => String(w).toLowerCase().slice(0, 3)));
  document.querySelectorAll('input[name="loc-wd"]').forEach((el) => {
    el.checked = wds.has(String(el.value).toLowerCase().slice(0, 3));
  });
  const title = document.querySelector('#fh-local-dlg h2');
  if (title) title.textContent = r.id ? `Edit local · ${r.id}` : 'Local / tour sailing';
}

async function refreshLocalList() {
  try {
    const res = await fetch(apiUrl('api/ferryhopper/local'), { cache: 'no-store' });
    const data = await res.json();
    const rows = data.sailings || [];
    locListEl.innerHTML = rows.length
      ? rows
          .map(
            (r) =>
              `<li><button type="button" class="ghost-dark loc-edit" data-id="${escapeAttr(r.id)}">Edit</button> ` +
              `<strong>${escapeHtml(r.vessel)}</strong> ${escapeHtml(r.origin)}→${escapeHtml(r.dest)} ` +
              `${escapeHtml(r.depart)} ` +
              (r.date ? escapeHtml(r.date) : `wd:${escapeHtml((r.weekdays || []).join(','))}`) +
              (r.active === false ? ' <em>[off]</em>' : '') +
              ` <button type="button" class="ghost-dark loc-del" data-id="${escapeAttr(r.id)}">Delete</button></li>`,
          )
          .join('')
      : '<li>No local entries yet.</li>';
    locListEl.querySelectorAll('.loc-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await fetch(apiUrl(`api/ferryhopper/local?id=${encodeURIComponent(btn.dataset.id)}`), { method: 'DELETE' });
        await refreshLocalList();
        await loadSailings();
      });
    });
    locListEl.querySelectorAll('.loc-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = rows.find((x) => x.id === btn.dataset.id);
        if (!row) return;
        fillLocForm(row);
        syncLocalDatalists();
        document.getElementById('fh-local-dlg')?.showModal();
      });
    });
  } catch {
    locListEl.innerHTML = '<li>Could not load local list.</li>';
  }
}

async function addLocalSailing() {
  const body = locFormBody();
  const updating = !!body.id;
  if (updating) body.action = 'update';
  try {
    const res = await fetch(apiUrl('api/ferryhopper/local'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    setStatus(`${updating ? 'Updated' : 'Saved'} local sailing ${data.entry?.id || ''}`);
    clearLocForm();
    document.getElementById('fh-local-dlg')?.close();
    await refreshLocalList();
    await loadSailings();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

function voyageLinks(v) {
  const bits = [];
  if (v.operator_schedules)
    bits.push(`<a href="${escapeAttr(v.operator_schedules)}" target="_blank" rel="noopener">Schedules</a>`);
  if (v.operator_url)
    bits.push(`<a href="${escapeAttr(v.operator_url)}" target="_blank" rel="noopener">Site</a>`);
  if (v.operator_contact) bits.push(`<span>${escapeHtml(v.operator_contact)}</span>`);
  const withBook = v.dests.find((d) => d.book_url);
  if (withBook) {
    const one = ensureClientBookUrl({ book_url: withBook.book_url, date: v.date || '' });
    if (one.book_url) bits.push(`<a href="${escapeAttr(one.book_url)}" target="_blank" rel="noopener">Book</a>`);
  }
  return bits.length ? bits.map((b) => `<span class="fh-link-item">${b}</span>`).join('') : '—';
}

function voyageDetailsBtn(v) {
  const id = v.dests.find((d) => d.trip_id)?.trip_id;
  if (!id) return '';
  return `<span class="fh-link-item"><button type="button" class="ghost-dark fh-det" data-id="${escapeAttr(id)}">Details</button></span>`;
}

function opLinks(r) {
  const bits = [];
  if (r.operator_schedules)
    bits.push(`<a href="${escapeAttr(r.operator_schedules)}" target="_blank" rel="noopener">Schedules</a>`);
  if (r.operator_url)
    bits.push(`<a href="${escapeAttr(r.operator_url)}" target="_blank" rel="noopener">Site</a>`);
  if (r.operator_contact) bits.push(`<span>${escapeHtml(r.operator_contact)}</span>`);
  const one = ensureClientBookUrl({ ...r });
  if (one.book_url)
    bits.push(`<a href="${escapeAttr(one.book_url)}" target="_blank" rel="noopener">Book</a>`);
  return bits.length ? bits.map((b) => `<span class="fh-link-item">${b}</span>`).join('') : '—';
}

function detailsBtn(r) {
  if (!r.trip_id) return '';
  return `<span class="fh-link-item"><button type="button" class="ghost-dark fh-det" data-id="${escapeAttr(r.trip_id)}">Details</button></span>`;
}

function ymdCompact(day) {
  return String(day || '')
    .replace(/-/g, '')
    .slice(0, 8);
}

function codesFromRow(r) {
  if (!r) return ['', ''];
  if (r.dep_code && r.arr_code) return [r.dep_code, r.arr_code];
  try {
    const u = new URL(r.book_url || '', 'https://www.ferryhopper.com');
    const it = u.searchParams.get('itinerary');
    if (it) {
      const parts = it.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) return [parts[0], parts[1]];
    }
    return [u.searchParams.get('from') || '', u.searchParams.get('to') || ''];
  } catch {
    return ['', ''];
  }
}

/** Ferryhopper booking/results — one-way or out+return (A,B,A). */
function bookingResultsUrl(legs) {
  const clean = legs.filter((L) => L && L[0] && L[1] && ymdCompact(L[2]).length === 8);
  if (!clean.length) return '';
  if (clean.length === 1) {
    const [a, b, d] = clean[0];
    return `https://www.ferryhopper.com/booking/results?itinerary=${a},${b}&dates=${ymdCompact(d)}`;
  }
  if (clean.length === 2) {
    const [a1, b1, d1] = clean[0];
    const [a2, b2, d2] = clean[1];
    if (a1 === b2 && b1 === a2) {
      return `https://www.ferryhopper.com/booking/results?itinerary=${a1},${b1},${a1}&dates=${ymdCompact(d1)},${ymdCompact(d2)}`;
    }
  }
  const ports = [clean[0][0], clean[0][1]];
  const dates = [ymdCompact(clean[0][2])];
  for (let i = 1; i < clean.length; i++) {
    const [dep, arr, day] = clean[i];
    if (ports[ports.length - 1] === dep) ports.push(arr);
    else ports.push(dep, arr);
    dates.push(ymdCompact(day));
  }
  return `https://www.ferryhopper.com/booking/results?itinerary=${ports.join(',')}&dates=${dates.join(',')}`;
}

function bookingUrlForPicks(out, ret) {
  const legs = [];
  for (const r of [out, ret]) {
    if (!r) continue;
    const [dep, arr] = codesFromRow(r);
    if (dep && arr && r.date) legs.push([dep, arr, r.date]);
  }
  return bookingResultsUrl(legs);
}

function ensureClientBookUrl(r) {
  if (!r || typeof r !== 'object') return r;
  const [dep, arr] = codesFromRow(r);
  if (dep && arr && r.date) {
    r.dep_code = dep;
    r.arr_code = arr;
    r.book_url = bookingResultsUrl([[dep, arr, r.date]]);
  }
  return r;
}

function registerPick(r) {
  const key = `p${++pickSeq}`;
  pickByKey.set(key, r);
  return key;
}

function pickMeta(r, extraClass = '') {
  const key = registerPick(r);
  const slot = (r.direction || 'out') === 'in' ? 'in' : 'out';
  const picked =
    state.tripPicks[slot] &&
    state.tripPicks[slot].depart === r.depart &&
    state.tripPicks[slot].vessel === r.vessel &&
    state.tripPicks[slot].origin === r.origin &&
    state.tripPicks[slot].dest === r.dest &&
    state.tripPicks[slot].date === r.date;
  const cls = [
    extraClass,
    'fh-pickable',
    picked ? 'is-picked' : '',
    r.source === 'Local' ? 'fh-local-row' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { key, attrs: `class="${cls}" data-pick="${escapeAttr(key)}"` };
}

function pickAttr(r, extraClass = '') {
  return pickMeta(r, extraClass).attrs;
}

function updateFiltersBadge() {
  const badge = document.getElementById('fh-filters-badge');
  if (!badge) return;
  const n = (state.tripPicks.out ? 1 : 0) + (state.tripPicks.in ? 1 : 0);
  if (n) {
    badge.hidden = false;
    badge.textContent = String(n);
  } else {
    badge.hidden = true;
    badge.textContent = '';
  }
}

function renderTripSide() {
  const side = document.getElementById('fh-trip-side');
  // Trip pick only works from day/agenda cards — hide on week/month/vessels or when pref off.
  if (side) {
    const show =
      state.showTripPicker !== false && (state.view === 'day' || state.view === 'agenda');
    side.hidden = !show;
    side.classList.toggle('is-hidden', !show);
  }
  updateFiltersBadge();
  for (const slot of ['out', 'in']) {
    const el = document.getElementById(slot === 'out' ? 'fh-pick-out' : 'fh-pick-in');
    if (!el) continue;
    const r = state.tripPicks[slot];
    const title = slot === 'out' ? 'Outbound' : 'Return';
    if (!r) {
      el.innerHTML = `<h3>${title}</h3><p class="muted fh-pick-empty">— select from table —</p>`;
      continue;
    }
    const legUrl = bookingUrlForPicks(slot === 'out' ? r : null, slot === 'in' ? r : null);
    el.innerHTML = `<h3>${title}</h3>
      <p class="fh-pick-body">${escapeHtml(dirMark(r.direction))} ${escapeHtml(r.date || '')}
${escapeHtml(r.depart || '—')} → ${escapeHtml(r.arrive || '—')}
${escapeHtml(r.vessel || '—')}
${escapeHtml(r.operator || '—')}
${escapeHtml(r.origin || '—')} → ${escapeHtml(r.dest || '—')}
Via ${escapeHtml(r.via || '—')} · ${escapeHtml(r.price || '—')} · ${escapeHtml(r.duration || '—')}</p>
      <div class="fh-pick-actions">
        ${
          legUrl
            ? `<a class="ghost-dark" href="${escapeAttr(legUrl)}" target="_blank" rel="noopener">Book leg</a>`
            : '<span class="muted">No book link</span>'
        }
        <button type="button" class="ghost-dark fh-pick-clear" data-clear="${slot}">Clear</button>
        ${detailsBtn(r)}
      </div>`;
  }
  let both = document.getElementById('fh-book-selected');
  if (side && !both) {
    both = document.createElement('a');
    both.id = 'fh-book-selected';
    both.className = 'ghost-dark fh-book-selected';
    both.target = '_blank';
    both.rel = 'noopener';
    side.appendChild(both);
  }
  if (both) {
    const url = bookingUrlForPicks(state.tripPicks.out, state.tripPicks.in);
    if (url) {
      both.href = url;
      both.textContent = 'Book selected on Ferryhopper';
      both.removeAttribute('aria-disabled');
      both.classList.remove('is-disabled');
    } else {
      both.removeAttribute('href');
      both.textContent = 'Book selected (double-click a row)';
      both.setAttribute('aria-disabled', 'true');
      both.classList.add('is-disabled');
    }
  }
  elBindTripSide();
}

function elBindTripSide() {
  document.querySelectorAll('.fh-pick-clear').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tripPicks[btn.dataset.clear] = null;
      render();
    });
  });
  document.querySelectorAll('#fh-trip-side .fh-det').forEach((btn) => {
    btn.addEventListener('click', () => openDetails(btn.dataset.id));
  });
  const both = document.getElementById('fh-book-selected');
  if (both && !both.dataset.bound) {
    both.dataset.bound = '1';
    both.addEventListener('click', (ev) => {
      if (!both.href || both.classList.contains('is-disabled')) {
        ev.preventDefault();
        return;
      }
      const hint = bookMatchHint(state.tripPicks.out, state.tripPicks.in);
      if (hint) setStatus(`On Ferryhopper select:\n${hint}`);
    });
  }
}

function setTripPick(r) {
  const slot = (r.direction || 'out') === 'in' ? 'in' : 'out';
  state.tripPicks[slot] = ensureClientBookUrl({ ...r });
  setStatus(
    `Picked ${slot === 'in' ? 'return' : 'outbound'}: ${r.depart || ''} ${r.vessel || ''} ${r.origin || ''}→${r.dest || ''}`,
  );
  render();
}

function voyageAsPick(v) {
  const isIn = (v.direction || 'out') === 'in';
  const first = (isIn ? v.dests[v.dests.length - 1] : v.dests[0]) || {};
  const dur =
    first.duration_min != null && first.duration_min !== ''
      ? `${Math.round(Number(first.duration_min))} min`
      : '—';
  const chain = itineraryChainVoyage(v, 16);
  return {
    direction: v.direction,
    date: v.date || '',
    depart: isIn ? v.arrive || v.depart : v.depart,
    arrive: v.arrive || first.arrive || '',
    vessel: v.vessel,
    operator: v.operator,
    origin: isIn ? v.origin || v.dests.map((d) => d.name).join(' - ') : v.origin,
    dest: chain,
    via: '',
    price: priceRange(v.dests) || first.price || '—',
    duration: dur,
    book_url: v.dests.find((d) => d.book_url)?.book_url || '',
    trip_id: v.dests.find((d) => d.trip_id)?.trip_id || '',
    source: v.source,
  };
}

function voyageSlotTime(v) {
  return (v.direction || 'out') === 'in' ? v.arrive || v.depart || v.slotTime || '' : v.depart || v.slotTime || '';
}

function voyagePortsLine(v, maxShow = 12) {
  return itineraryChainVoyage(v, maxShow);
}

/** RODOS - KOS - KALYMNOS … (grouped or flat; no Via). */
function itineraryChainVoyage(v, maxShow = 99) {
  const isIn = (v.direction || 'out') === 'in';
  const stops = (v.dests || []).map((d) => d.name).filter(Boolean);
  let parts;
  if (isIn) {
    parts = [...stops, v.dest].filter(Boolean);
  } else {
    parts = [v.origin, ...stops].filter(Boolean);
  }
  const out = [];
  for (const p of parts) {
    if (!out.length || out[out.length - 1].toLowerCase() !== String(p).toLowerCase()) out.push(p);
  }
  if (!out.length) return '—';
  if (out.length <= maxShow) return out.join(' - ');
  return `${out.slice(0, maxShow).join(' - ')} +${out.length - maxShow}`;
}

function itineraryChainRow(r) {
  const parts = [];
  const push = (s) => {
    String(s || '')
      .replace(/→/g, ',')
      .replace(/ - /g, ',')
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x && x !== '—')
      .forEach((p) => {
        if (!parts.length || parts[parts.length - 1].toLowerCase() !== p.toLowerCase()) parts.push(p);
      });
  };
  push(r.origin);
  push(r.dest);
  return parts.length ? parts.join(' - ') : '—';
}

function fmtDuration(r) {
  if (r.duration && r.duration !== '—') return r.duration;
  const m = Number(r.duration_min);
  if (!Number.isFinite(m)) return '';
  const h = Math.floor(m / 60);
  const mi = Math.round(m % 60);
  return h ? `${h}h ${String(mi).padStart(2, '0')}m` : `${mi} min`;
}

function tripWhen(r) {
  const isIn = (r.direction || 'out') === 'in';
  const dep = r.depart || '';
  const arr = r.arrive || '';
  if (dep && arr && dep !== arr && arr !== '—') return `${dep}–${arr}`;
  return isIn ? arr || dep || '' : dep || '';
}

function voyageWhen(v) {
  const isIn = (v.direction || 'out') === 'in';
  const dep = v.depart || '';
  const last = (v.dests && v.dests[v.dests.length - 1]) || {};
  const first = (v.dests && v.dests[0]) || {};
  const arr = v.arrive || last.arrive || first.arrive || '';
  if (dep && arr && dep !== arr && arr !== '—') return `${dep}–${arr}`;
  return isIn ? arr || dep || voyageSlotTime(v) : dep || voyageSlotTime(v);
}

function voyageDuration(v) {
  const last = (v.dests && v.dests[v.dests.length - 1]) || {};
  const first = (v.dests && v.dests[0]) || {};
  return fmtDuration(last.duration_min != null ? last : first.duration_min != null ? first : v);
}

function segHtml(text, bold) {
  const t = escapeHtml(text);
  return bold ? `<strong>${t}</strong>` : t;
}

function formatLegBlockHtml(vals, { wrapClass = '', localPill = false } = {}) {
  const vis = state.fieldVisible;
  const bld = state.fieldBold;
  let line1 = `${escapeHtml(vals.mark || '')} `;
  let has1 = false;
  if (vis.time && vals.time) {
    line1 += segHtml(vals.time, bld.time);
    has1 = true;
  }
  if (vis.duration && vals.duration) {
    line1 += ` (${segHtml(vals.duration, bld.duration)})`;
    has1 = true;
  }
  if (vis.vessel && vals.vessel) {
    line1 += (has1 ? ' · ' : '') + segHtml(vals.vessel, bld.vessel);
    has1 = true;
  }
  if (localPill) line1 += ' <span class="pill">Local</span>';
  const line2Parts = [];
  for (const key of ['operator', 'route', 'price']) {
    if (!vis[key] || !vals[key]) continue;
    line2Parts.push(segHtml(vals[key], bld[key]));
  }
  const line2 = line2Parts.join(' · ');
  if (!has1 && !line2) return `<div class="${wrapClass}">—</div>`;
  let html = `<div class="${wrapClass}">`;
  if (has1) html += `<div class="fh-leg-line1">${line1}</div>`;
  if (line2) html += `<div class="fh-leg-line2 meta">${line2}</div>`;
  html += '</div>';
  return html;
}

function legValsFromRow(r) {
  const route = itineraryChainRow(r);
  const via =
    r.via &&
    r.via !== '—' &&
    !route.toLowerCase().includes(String(r.via).split(',')[0].trim().toLowerCase())
      ? `via ${r.via}`
      : '';
  return {
    mark: dirMark(r.direction),
    time: tripWhen(r),
    duration: fmtDuration(r),
    vessel: r.vessel || '',
    operator: r.operator || '',
    route: via ? `${route} · ${via}` : route,
    price: r.price && r.price !== '—' ? r.price : '',
  };
}

function legValsFromVoyage(v) {
  let route = itineraryChainVoyage(v, 99);
  if (!state.groupVoyages && v.via && v.via !== '—') {
    if (
      !String(v.via)
        .split(',')
        .every((p) => route.toLowerCase().includes(String(p).trim().toLowerCase()))
    ) {
      route = `${route} · via ${v.via}`;
    }
  }
  const pr = priceRange(v.dests);
  return {
    mark: dirMark(v.direction),
    time: voyageWhen(v),
    duration: voyageDuration(v),
    vessel: v.vessel || '',
    operator: v.operator || '',
    route,
    price: pr && pr !== '—' ? pr : '',
  };
}

function voyageCardHtml(v) {
  const pick = voyageAsPick(v);
  const block = formatLegBlockHtml(legValsFromVoyage(v), {
    wrapClass: 'fh-card-body',
    localPill: v.source === 'Local',
  });
  return `<article ${pickAttr(pick, 'fh-card')}>
    ${block}
    <div class="fh-links">${voyageLinks(v)}${voyageDetailsBtn(v)}</div>
  </article>`;
}

function preferTapToPick() {
  return window.matchMedia('(max-width: 899px), (pointer: coarse)').matches;
}

function bindPickClicks() {
  mainEl.querySelectorAll('[data-pick]').forEach((el) => {
    const pick = () => {
      const r = pickByKey.get(el.dataset.pick);
      if (r) setTripPick(r);
    };
    el.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('a,button')) return;
      ev.preventDefault();
      pick();
    });
    // Mobile cards: single tap (desktop tables keep dblclick only).
    if (preferTapToPick() && el.matches('article, .fh-card, .fh-leg-card')) {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('a,button')) return;
        ev.preventDefault();
        pick();
      });
    }
  });
}

/** Human hint — Ferryhopper results URLs cannot pre-select a vessel/time card. */
function bookMatchHint(out, ret) {
  const lines = [];
  for (const [label, r] of [
    ['Outbound', out],
    ['Return', ret],
  ]) {
    if (!r) continue;
    lines.push(
      `${label}: ${r.depart || '—'} ${r.vessel || '—'} · ${r.origin || ''}→${r.dest || ''} (${r.date || ''})`,
    );
  }
  return lines.join('\n');
}

function renderDay(rows) {
  if (!rows.length) return '<p class="muted">No sailings for this filter / cache.</p>';
  const hubs = hubNames();
  const dir = directionEl.value || 'both';
  const sections = [];
  if (dir === 'both' || dir === 'out') {
    const leaving = rows.filter((r) => isLeaving(r, hubs));
    sections.push({ title: `Leaving ${hubs.join(', ')}`, rows: leaving });
  }
  if (dir === 'both' || dir === 'in') {
    const returning = rows.filter((r) => isReturning(r, hubs));
    sections.push({ title: `Returning to ${hubs.join(', ')}`, rows: returning });
  }
  if (dir === 'both' && sections.every((s) => !s.rows.length)) {
    sections.length = 0;
    sections.push({ title: 'All', rows });
  }

  let html = '';
  for (const sec of sections) {
    if (!sec.rows.length && dir === 'both') {
      html += `<h3 class="fh-day-head">${escapeHtml(sec.title)}</h3><p class="muted">None in cache — Fetch if needed.</p>`;
      continue;
    }
    if (sections.length > 1) {
      html += `<h3 class="fh-day-head">${escapeHtml(sec.title)} · ${sec.rows.length}</h3>`;
    }
    html += officeBucketHtml(sec.rows, { showEmpty: true });
  }
  return `<div class="fh-day-office">${html}</div>`;
}

function renderAgendaBucketBody(bucketRows, { showEmpty } = {}) {
  return officeBucketHtml(bucketRows, { showEmpty });
}

function renderAgenda(rows) {
  if (!rows.length) return '<p class="muted">No sailings.</p>';
  const hubs = hubNames();
  const dir = directionEl.value || 'both';
  const byDayMode = state.agendaGroup === 'day' && dir === 'both';

  let html = '<div class="fh-agenda">';
  if (byDayMode) {
    const byDay = new Map();
    for (const r of rows) {
      const d = r.date || '';
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(r);
    }
    for (const [day, dayRows] of [...byDay.entries()].sort()) {
      const leaving = dayRows.filter((r) => isLeaving(r, hubs));
      const returning = dayRows.filter((r) => isReturning(r, hubs));
      const sample = dayRows[0];
      html += `<section class="fh-agenda-day"><h3 class="fh-day-head">${escapeHtml(sample?.date_display || day)} · ${escapeHtml(sample?.weekday || '')}</h3>`;
      if (leaving.length) {
        html += `<h4 class="fh-day-sub">Leaving ${escapeHtml(hubs.join(', '))} · ${leaving.length}</h4>`;
        html += renderAgendaBucketBody(leaving);
      }
      if (returning.length) {
        html += `<h4 class="fh-day-sub">Returning to ${escapeHtml(hubs.join(', '))} · ${returning.length}</h4>`;
        html += renderAgendaBucketBody(returning);
      }
      if (!leaving.length && !returning.length) {
        html += renderAgendaBucketBody(dayRows, { showEmpty: true });
      }
      html += '</section>';
    }
    html += '</div>';
    return html;
  }

  const buckets =
    dir === 'both'
      ? [
          { title: `Leaving ${hubs.join(', ')}`, rows: rows.filter((r) => isLeaving(r, hubs)) },
          { title: `Returning to ${hubs.join(', ')}`, rows: rows.filter((r) => isReturning(r, hubs)) },
        ]
      : [{ title: '', rows }];
  const use =
    dir === 'both' && buckets.every((b) => !b.rows.length) ? [{ title: 'All', rows }] : buckets;

  for (const bucket of use) {
    if (!state.groupVoyages) {
      if (bucket.title) {
        html += `<h3 class="fh-day-head">${escapeHtml(bucket.title)} · ${bucket.rows.length}</h3>`;
        if (!bucket.rows.length) {
          html += `<p class="muted">None in cache — Fetch if needed.</p>`;
          continue;
        }
      } else if (!bucket.rows.length) {
        return '<p class="muted">No sailings.</p>';
      }
      html += renderDay(bucket.rows);
      continue;
    }
    const voyages = groupVoyages(sortLegsByTime(bucket.rows));
    if (bucket.title) {
      html += `<h3 class="fh-day-head">${escapeHtml(bucket.title)} · ${voyages.length}</h3>`;
      if (!voyages.length) {
        html += `<p class="muted">None in cache — Fetch if needed.</p>`;
        continue;
      }
    } else if (!voyages.length) {
      return '<p class="muted">No sailings.</p>';
    }
    const byDay = new Map();
    for (const v of voyages) {
      const d = v.date || '';
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(v);
    }
    for (const [day, list] of [...byDay.entries()].sort()) {
      html += `<h4 class="fh-day-sub">${escapeHtml(list[0]?.date_display || day)} · ${escapeHtml(list[0]?.weekday || '')}</h4>`;
      for (const v of list) {
        html += voyageCardHtml(v);
      }
    }
  }
  html += '</div>';
  return html;
}

function orderWeekDayRows(dayRows, hubs, showDir) {
  const leaving = showDir === 'in' ? [] : dayRows.filter((r) => isLeaving(r, hubs));
  const returning = showDir === 'out' ? [] : dayRows.filter((r) => isReturning(r, hubs));
  const other =
    showDir === 'both' ? dayRows.filter((r) => !isLeaving(r, hubs) && !isReturning(r, hubs)) : [];
  if (state.weekLegOrder === 'by_time') {
    return sortLegsByTime(dayRows);
  }
  // Time-sort within each bucket so out_in ≠ interleaved by_time.
  return [...sortLegsByTime(leaving), ...sortLegsByTime(other), ...sortLegsByTime(returning)];
}

function weekItemsHtml(ordered) {
  const voyages = state.groupVoyages ? groupVoyages(ordered) : null;
  const items = voyages
    ? voyages.map((v) => formatLegBlockHtml(legValsFromVoyage(v), { wrapClass: 'fh-week-item' }))
    : ordered.map((r) => formatLegBlockHtml(legValsFromRow(r), { wrapClass: 'fh-week-item' }));
  const n = voyages ? voyages.length : ordered.length;
  return {
    n,
    html: items.join('') || '<div class="muted" style="font-size:0.7rem">—</div>',
  };
}

function renderWeek(rows) {
  // Always Mon–Sun of the selected week so columns match the loaded cache.
  const from = weekStartISO(dateEl.value || todayISO());
  const start = new Date(from + 'T12:00:00');
  const hubs = hubNames();
  const showDir = directionEl.value || state.direction || 'both';
  const split = state.weekSplit === 'rows' ? 'rows' : 'dual';
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = localISO(d);
    const dayRows = rows.filter((r) => r.date === iso && matchesShowDirection(r, showDir, hubs));
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    const leaving = showDir === 'in' ? [] : dayRows.filter((r) => isLeaving(r, hubs));
    const returning = showDir === 'out' ? [] : dayRows.filter((r) => isReturning(r, hubs));
    const other =
      showDir === 'both'
        ? dayRows.filter((r) => !isLeaving(r, hubs) && !isReturning(r, hubs))
        : [];
    const out = weekItemsHtml(orderWeekDayRows([...leaving, ...other], hubs, 'out'));
    const inn = weekItemsHtml(orderWeekDayRows(returning, hubs, 'in'));
    days.push({
      title: `${iso.slice(8)} ${dow}`,
      out,
      inn,
    });
  }
  if (split === 'rows') {
    let html = '<div class="fh-week-rows"><div class="fh-week-rows-lab"></div>';
    for (const day of days) html += `<div class="fh-week-rows-h">${escapeHtml(day.title)}</div>`;
    html += '<div class="fh-week-rows-lab">Out</div>';
    for (const day of days) {
      html += `<div class="fh-week-rows-cell"><div class="fh-week-col-body">${day.out.html}</div></div>`;
    }
    html += '<div class="fh-week-rows-lab">Return</div>';
    for (const day of days) {
      html += `<div class="fh-week-rows-cell"><div class="fh-week-col-body">${day.inn.html}</div></div>`;
    }
    html += '</div>';
    return html;
  }
  let html =
    '<div class="fh-week-vdual"><div class="fh-week-vdual-lab"></div>' +
    '<div class="fh-week-vdual-h">Out</div><div class="fh-week-vdual-h">Return</div>';
  for (const day of days) {
    html += `<div class="fh-week-vdual-lab">${escapeHtml(day.title)}</div>`;
    html += `<div class="fh-week-vdual-cell"><div class="fh-week-col-body">${day.out.html}</div></div>`;
    html += `<div class="fh-week-vdual-cell"><div class="fh-week-col-body">${day.inn.html}</div></div>`;
  }
  html += '</div>';
  return html;
}

function renderMonth(rows) {
  const from = dateEl.value || todayISO();
  const base = new Date(from + 'T12:00:00');
  const y = base.getFullYear();
  const m = base.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const startPad = (first.getDay() + 6) % 7;
  const hubs = hubNames();
  const showDir = directionEl.value || state.direction || 'both';
  const byDay = new Map();
  for (const r of rows) {
    if (!r.date) continue;
    if (!matchesShowDirection(r, showDir, hubs)) continue;
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date).push(r);
  }
  for (const [day, list] of byDay.entries()) {
    const ordered = orderWeekDayRows(list, hubs, showDir);
    byDay.set(day, state.groupVoyages ? groupVoyages(ordered) : ordered);
  }
  const heads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map((h) => `<div class="fh-month-cell muted fh-month-head">${h}</div>`)
    .join('');
  let cells = '';
  for (let i = 0; i < startPad; i++) cells += '<div class="fh-month-cell muted"></div>';
  for (let day = 1; day <= last.getDate(); day++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const list = byDay.get(iso) || [];
    const preview = list
      .map((item) =>
        formatLegBlockHtml(state.groupVoyages ? legValsFromVoyage(item) : legValsFromRow(item), {
          wrapClass: 'fh-month-leg',
        }),
      )
      .join('');
    cells += `<div class="fh-month-cell" data-day="${iso}"><div class="fh-month-daynum">${day}</div>${preview || '<div class="count">—</div>'}</div>`;
  }
  return `<div class="fh-month fh-month-detail">${heads}${cells}</div>`;
}

function dayTitle(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}

function renderDayGrouped(rows) {
  if (!rows.length) return '<p class="muted">No sailings for this filter / cache.</p>';
  const hubs = hubNames();
  const dir = directionEl.value || 'both';
  const sections = [];
  if (dir === 'both' || dir === 'out') {
    sections.push({ title: `Leaving ${hubs.join(', ')}`, rows: rows.filter((r) => isLeaving(r, hubs)) });
  }
  if (dir === 'both' || dir === 'in') {
    sections.push({ title: `Returning to ${hubs.join(', ')}`, rows: rows.filter((r) => isReturning(r, hubs)) });
  }
  if (dir === 'both' && sections.every((s) => !s.rows.length)) {
    sections.length = 0;
    sections.push({ title: 'All', rows });
  }
  let html = '';
  for (const sec of sections) {
    const voyages = groupVoyages(sortLegsByTime(sec.rows));
    html += `<h3 class="fh-day-head">${escapeHtml(sec.title)} · ${voyages.length} voyages</h3>`;
    if (!voyages.length) {
      html += `<p class="muted">None in cache — Fetch if needed.</p>`;
      continue;
    }
    html += officeTableHtml(
      voyages.map((v) => officeRowWithPick(officeRowFromVoyage(v), voyageAsPick(v))),
    );
    html += `<div class="fh-day-cards">${voyages.map((v) => voyageCardHtml(v)).join('')}</div>`;
  }
  return `<div class="fh-day-office">${html}</div>`;
}

function render() {
  pickByKey.clear();
  pickSeq = 0;
  const rows = filteredSailings();
  let html = '';
  if (state.view === 'day') {
    const day = dateEl.value || todayISO();
    const dayRows = rows.filter((r) => r.date === day);
    const use = dayRows.length ? dayRows : rows;
    html =
      `<h2 class="fh-day-head">${escapeHtml(dayTitle(day))}</h2>` +
      (state.groupVoyages ? renderDayGrouped(use) : renderDay(use));
  } else if (state.view === 'agenda') html = renderAgenda(rows);
  else if (state.view === 'week') html = renderWeek(rows);
  else if (state.view === 'vessels') html = renderVessels(rows);
  else html = renderMonth(rows);
  mainEl.innerHTML = html;
  mainEl.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortCol === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else {
        state.sortCol = col;
        state.sortDir = 'asc';
      }
      render();
    });
  });
  mainEl.querySelectorAll('.fh-det').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openDetails(btn.dataset.id);
    });
  });
  mainEl.querySelectorAll('.fh-month-cell[data-day]').forEach((cell) => {
    cell.addEventListener('click', () => {
      dateEl.value = cell.dataset.day;
      dateEndEl.value = '';
      applyViewOnly('day');
      loadSailings();
    });
  });
  bindPickClicks();
  renderTripSide();
  bindWeekScrollSync();
  bindTableTools();
  enableBoardDragScroll();
}

function tableFromEl(table) {
  const cols = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.cells].map((td) => td.textContent.trim()),
  );
  return { cols, rows };
}

function formatTableText({ cols, rows }, fmt) {
  const esc = (v, sep) => {
    const s = String(v ?? '');
    if (sep === '\t') return s.replace(/\t/g, ' ').replace(/\n/g, ' ');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  if (fmt === 'tsv') {
    return [cols.join('\t'), ...rows.map((r) => r.map((c) => esc(c, '\t')).join('\t'))].join('\n') + '\n';
  }
  if (fmt === 'csv') {
    return [cols.map((c) => esc(c, ',')).join(','), ...rows.map((r) => r.map((c) => esc(c, ',')).join(','))].join(
      '\n',
    ) + '\n';
  }
  if (fmt === 'md') {
    const head = `| ${cols.join(' | ')} |`;
    const sep = `| ${cols.map(() => '---').join(' | ')} |`;
    const body = rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`);
    return [head, sep, ...body].join('\n') + '\n';
  }
  const th = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function sailingsAsTable(rows) {
  const cols = OFFICE_COLS.map(([, lab]) => lab || 'Dir');
  const data = rows.map((r) => {
    const o = officeRowFromLeg(r);
    return OFFICE_COLS.map(([k]) => o[k] ?? '');
  });
  return { cols, rows: data };
}

function vesselsAsTable(rows) {
  const cols = ['Day', 'Vessel', 'Port', 'Arrival', 'Departure'];
  const data = [];
  const byDay = new Map();
  for (const r of rows) {
    const day = r.date || '—';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  for (const [day, dayRows] of [...byDay.entries()].sort()) {
    const byVessel = new Map();
    for (const r of dayRows) {
      const vessel = r.vessel || '—';
      if (!byVessel.has(vessel)) byVessel.set(vessel, []);
      byVessel.get(vessel).push(r);
    }
    for (const vessel of [...byVessel.keys()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )) {
      for (const p of vesselDayPortRows(byVessel.get(vessel))) {
        data.push([day, vessel, p.port || '', p.arrival || '', p.departure || '']);
      }
    }
  }
  return { cols, rows: data };
}

function viewExportTable() {
  const rows = filteredSailings();
  if (state.view === 'vessels') return vesselsAsTable(rows);
  if (state.view === 'day') {
    const day = dateEl.value || todayISO();
    const dayRows = rows.filter((r) => r.date === day);
    return sailingsAsTable(dayRows.length ? dayRows : rows);
  }
  return sailingsAsTable(rows);
}

function savedExportFormats() {
  try {
    const raw = localStorage.getItem('fh_export_formats');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr.filter((x) => ['csv', 'tsv', 'md', 'html'].includes(x));
    }
  } catch {
    /* ignore */
  }
  return state.exportFormats || ['csv'];
}

function persistExportFormats(fmts) {
  const clean = (fmts || []).filter((x) => ['csv', 'tsv', 'md', 'html'].includes(x));
  state.exportFormats = clean.length ? clean : ['csv'];
  try {
    localStorage.setItem('fh_export_formats', JSON.stringify(state.exportFormats));
  } catch {
    /* ignore */
  }
  savePrefs();
}

function openFormatDialog(tableData, { prefer, formats } = {}) {
  const existing = document.getElementById('fh-format-dlg');
  if (existing) existing.remove();
  const saved = formats || savedExportFormats();
  const dlg = document.createElement('dialog');
  dlg.id = 'fh-format-dlg';
  dlg.className = 'fh-format-dlg';
  dlg.innerHTML = `<h3>Copy / Export table</h3>
    <label><input type="checkbox" name="fmt" value="csv"${saved.includes('csv') ? ' checked' : ''} /> CSV</label>
    <label><input type="checkbox" name="fmt" value="tsv"${saved.includes('tsv') ? ' checked' : ''} /> TSV</label>
    <label><input type="checkbox" name="fmt" value="md"${saved.includes('md') ? ' checked' : ''} /> Markdown</label>
    <label><input type="checkbox" name="fmt" value="html"${saved.includes('html') ? ' checked' : ''} /> HTML</label>
    <div class="fh-format-actions">
      <button type="button" data-act="copy">Copy</button>
      <button type="button" data-act="save">Save…</button>
      <button type="button" data-act="close">Cancel</button>
    </div>`;
  document.body.appendChild(dlg);
  const picked = () => [...dlg.querySelectorAll('input[name=fmt]:checked')].map((el) => el.value);
  dlg.querySelector('[data-act=close]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-act=copy]').addEventListener('click', async () => {
    const fmts = picked();
    if (!fmts.length) return;
    persistExportFormats(fmts);
    const preferFmt = prefer === 'copy' && fmts.includes('tsv') ? 'tsv' : fmts[0];
    let text =
      fmts.length === 1
        ? formatTableText(tableData, preferFmt)
        : fmts.map((f) => `--- ${f.toUpperCase()} ---\n${formatTableText(tableData, f)}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    dlg.close();
  });
  dlg.querySelector('[data-act=save]').addEventListener('click', () => {
    const fmts = picked();
    if (!fmts.length) return;
    persistExportFormats(fmts);
    const ext = { csv: 'csv', tsv: 'tsv', md: 'md', html: 'html' };
    for (const f of fmts) {
      const blob = new Blob([formatTableText(tableData, f)], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ferries-table.${ext[f]}`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

function doPrintView() {
  const { from, to, direction } = rangeParams();
  const vesselBits =
    state.view === 'vessels' ? ` · vessels=${state.vesselsLayout || 'stack'}` : '';
  document.title = `Ferries ${from}${to && to !== from ? '→' + to : ''} · ${state.view} · ${direction}${state.groupVoyages ? ' · grouped' : ' · flat'}${vesselBits}`;
  document.body.classList.add('fh-printing');
  document.body.classList.toggle(
    'fh-print-landscape',
    state.view === 'week' || (state.view === 'vessels' && state.vesselsLayout === 'week'),
  );
  document.querySelectorAll('.fh-week-col-body').forEach((el) => {
    el.dataset.prevMax = el.style.maxHeight || '';
    el.style.maxHeight = 'none';
    el.style.overflow = 'visible';
  });
  const done = () => {
    document.body.classList.remove('fh-printing', 'fh-print-landscape');
    document.querySelectorAll('.fh-week-col-body').forEach((el) => {
      el.style.maxHeight = el.dataset.prevMax || '';
      el.style.overflow = '';
      delete el.dataset.prevMax;
    });
  };
  window.addEventListener('afterprint', done, { once: true });
  window.print();
}

function openExportDialog() {
  const existing = document.getElementById('fh-export-dlg');
  if (existing) existing.remove();
  const saved = savedExportFormats();
  const dlg = document.createElement('dialog');
  dlg.id = 'fh-export-dlg';
  dlg.className = 'fh-format-dlg';
  dlg.innerHTML = `<h3>Export</h3>
    <p class="muted">Copy formats (remembered)</p>
    <label><input type="checkbox" name="fmt" value="csv"${saved.includes('csv') ? ' checked' : ''} /> CSV</label>
    <label><input type="checkbox" name="fmt" value="tsv"${saved.includes('tsv') ? ' checked' : ''} /> TSV</label>
    <label><input type="checkbox" name="fmt" value="md"${saved.includes('md') ? ' checked' : ''} /> Markdown</label>
    <label><input type="checkbox" name="fmt" value="html"${saved.includes('html') ? ' checked' : ''} /> HTML</label>
    <div class="fh-format-actions">
      <button type="button" data-act="preview">Preview / Print</button>
      <button type="button" data-act="copy">Copy table…</button>
      <button type="button" data-act="close">Close</button>
    </div>`;
  document.body.appendChild(dlg);
  const picked = () => [...dlg.querySelectorAll('input[name=fmt]:checked')].map((el) => el.value);
  dlg.querySelector('[data-act=close]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-act=preview]').addEventListener('click', () => {
    persistExportFormats(picked());
    dlg.close();
    doPrintView();
  });
  dlg.querySelector('[data-act=copy]').addEventListener('click', () => {
    const fmts = picked();
    persistExportFormats(fmts);
    dlg.close();
    openFormatDialog(viewExportTable(), { formats: fmts });
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

function bindTableTools() {
  mainEl.querySelectorAll('[data-table-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const block = btn.closest('.fh-vessel-block');
      const table = block?.querySelector('table');
      if (!table) return;
      openFormatDialog(tableFromEl(table), { prefer: btn.dataset.tableAct });
    });
  });
}

function bindWeekScrollSync() {
  const bodies = [...mainEl.querySelectorAll('.fh-week-col-body')];
  if (bodies.length < 2) return;
  let lock = false;
  bodies.forEach((el) => {
    el.addEventListener('scroll', () => {
      if (!state.syncWeekScroll || lock) return;
      lock = true;
      bodies.forEach((o) => {
        if (o !== el) o.scrollTop = el.scrollTop;
      });
      lock = false;
    });
  });
}

async function openDetails(tripId) {
  const dlg = document.getElementById('fh-detail');
  const body = document.getElementById('fh-detail-body');
  body.textContent = 'Loading…';
  dlg.showModal();
  try {
    const res = await fetch(apiUrl(`api/ferryhopper/trip?id=${encodeURIComponent(tripId)}`), { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    body.textContent = JSON.stringify(data.details || data, null, 2);
  } catch (e) {
    body.textContent = String(e.message || e);
  }
}

function goToday() {
  const t = todayISO();
  dateEl.value = t;
  dateEndEl.value = '';
  setView('day');
  loadSailings();
}

function jumpRange(kind) {
  const t = todayISO();
  if (kind === 'today') {
    goToday();
    return;
  }
  if (kind === 'this_week') {
    const start = weekStartISO(t);
    dateEl.value = start;
    dateEndEl.value = addDaysISO(start, 6);
    setView('week');
  } else if (kind === 'next_week') {
    const start = addDaysISO(weekStartISO(t), 7);
    dateEl.value = start;
    dateEndEl.value = addDaysISO(start, 6);
    setView('week');
  } else if (kind === 'next_2_weeks') {
    dateEl.value = t;
    dateEndEl.value = addDaysISO(t, 13);
    setView('agenda');
  } else if (kind === 'this_month') {
    const start = `${t.slice(0, 8)}01`;
    dateEl.value = start;
    dateEndEl.value = monthEndISO(start);
    setView('month');
  } else if (kind === 'this_next_month') {
    const start = `${t.slice(0, 8)}01`;
    const nextStart = addMonthsISO(start, 1).slice(0, 8) + '01';
    dateEl.value = start;
    dateEndEl.value = monthEndISO(nextStart);
    setView('agenda');
  } else {
    return;
  }
  loadSailings();
  document.getElementById('fh-jump')?.removeAttribute('open');
}

function goPrev() {
  const from = dateEl.value || todayISO();
  if (state.view === 'week') {
    dateEl.value = addDaysISO(from, -7);
    dateEndEl.value = addDaysISO(dateEl.value, 6);
  } else if (state.view === 'month') {
    dateEl.value = addMonthsISO(from, -1).slice(0, 8) + '01';
    dateEndEl.value = monthEndISO(dateEl.value);
  } else {
    dateEl.value = addDaysISO(from, -1);
    dateEndEl.value = '';
  }
  loadSailings();
}

function goNext() {
  const from = dateEl.value || todayISO();
  if (state.view === 'week') {
    dateEl.value = addDaysISO(from, 7);
    dateEndEl.value = addDaysISO(dateEl.value, 6);
  } else if (state.view === 'month') {
    dateEl.value = addMonthsISO(from, 1).slice(0, 8) + '01';
    dateEndEl.value = monthEndISO(dateEl.value);
  } else {
    dateEl.value = addDaysISO(from, 1);
    dateEndEl.value = '';
  }
  loadSailings();
}

document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (state.fetching) return;
    // Re-render only — avoids top chrome flash from full reload
    applyViewOnly(btn.dataset.view);
  });
});

loadBtn?.addEventListener('click', () => {
  if (state.fetching) return;
  loadSailings();
  document.getElementById('fh-cache-menu')?.removeAttribute('open');
});
fetchBtn.addEventListener('click', () => runSequentialFetch());
document.getElementById('fh-export')?.addEventListener('click', () => openExportDialog());
document.getElementById('fh-q')?.addEventListener('input', () => render());
document.getElementById('fh-q-x')?.addEventListener('click', () => {
  const q = document.getElementById('fh-q');
  if (q) q.value = '';
  render();
});
document.getElementById('fh-date-end-x')?.addEventListener('click', () => {
  dateEndEl.value = '';
  savePrefs();
  loadSailings();
});
bindListClear(originsEl);
bindListClear(destsEl);
bindListClear(vesselsEl);
if (companiesEl) bindListClear(companiesEl);

function bindTimeFilter(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    state[key] = el.value || state[key];
    render();
  });
}
bindTimeFilter('fh-out-from', 'outFrom');
bindTimeFilter('fh-out-to', 'outTo');
bindTimeFilter('fh-in-from', 'inFrom');
bindTimeFilter('fh-in-to', 'inTo');
document.getElementById('fh-sync-week-scroll')?.addEventListener('change', (e) => {
  state.syncWeekScroll = !!e.target.checked;
});

function showAbout() {
  alert(
    'Rhodes Port Tracker — ferry planner (docs/ GH Pages repo).\n\n' +
      'Alex of Rhodes\n' +
      'alexofrhodes@gmail.com\n' +
      'https://github.com/alexofrhodes\n\n' +
      'Load/Fetch/Clear/local use the same docs/data cache as the GUI.\n' +
      'Missing day-direction cache files = Fetch fills them. Stop cancels pending days.\n' +
      'Disruptions = Ferryhopper country alerts for the selected day (not weather).\n' +
      'Print = what is on screen (day/agenda office tables; week/month grids; vessels itineraries).\n' +
      'Vessels = Port / Arrival / Departure per vessel per day (stack or Mon–Sun week).\n' +
      'Group voyages = one row/card per departure with all dests.',
  );
}
document.getElementById('about-btn')?.addEventListener('click', showAbout);
document.getElementById('fh-clear-cache')?.addEventListener('click', () => {
  clearCacheSlice();
  document.getElementById('fh-cache-menu')?.removeAttribute('open');
});
document.getElementById('fh-clear-all-cache')?.addEventListener('click', () => {
  clearAllSailingCache();
  document.getElementById('fh-cache-menu')?.removeAttribute('open');
});
document.querySelectorAll('[data-jump]').forEach((btn) => {
  btn.addEventListener('click', () => jumpRange(btn.dataset.jump));
});
document.getElementById('fh-group')?.addEventListener('change', (e) => {
  state.groupVoyages = !!e.target.checked;
  savePrefs();
  render();
});
document.getElementById('fh-vessels-layout')?.addEventListener('change', (e) => {
  state.vesselsLayout = e.target.value === 'week' ? 'week' : 'stack';
  savePrefs();
  applySmartDisplay();
  render();
});
document.getElementById('fh-vessels-autofit')?.addEventListener('change', (e) => {
  state.vesselsAutofit = !!e.target.checked;
  savePrefs();
  render();
});
document.getElementById('fh-smart-display')?.addEventListener('change', (e) => {
  state.smartDisplay = !!e.target.checked;
  savePrefs();
  applySmartDisplay();
});
document.getElementById('fh-board-fit')?.addEventListener('change', (e) => {
  state.boardFit = e.target.value === 'shrink' ? 'shrink' : 'scroll';
  savePrefs();
  applyBoardFit();
});
document.getElementById('fh-agenda-group')?.addEventListener('change', (e) => {
  state.agendaGroup = e.target.value === 'direction' ? 'direction' : 'day';
  savePrefs();
  render();
});
document.getElementById('fh-week-leg-order')?.addEventListener('change', (e) => {
  state.weekLegOrder = e.target.value === 'by_time' ? 'by_time' : 'out_in';
  savePrefs();
  render();
});
document.getElementById('fh-week-split')?.addEventListener('change', (e) => {
  state.weekSplit = e.target.value === 'rows' ? 'rows' : 'dual';
  savePrefs();
  render();
});
document.getElementById('fh-vessels-density')?.addEventListener('change', (e) => {
  const v = e.target.value;
  state.vesselsDensity = v === 'roomy' || v === 'tight' ? v : 'normal';
  savePrefs();
  render();
});
document.getElementById('fh-show-trip-picker')?.addEventListener('change', (e) => {
  state.showTripPicker = !!e.target.checked;
  savePrefs();
  renderTripSide();
});
function applyBoardFont(px) {
  const n = Math.max(12, Math.min(18, Number(px) || 14));
  document.documentElement.style.setProperty('--fh-board-font', `${n}px`);
  const el = document.getElementById('fh-font');
  if (el && String(el.value) !== String(n)) el.value = String(n);
}
document.getElementById('fh-font')?.addEventListener('input', (e) => {
  applyBoardFont(e.target.value);
  try {
    localStorage.setItem('fh-board-font', String(e.target.value));
  } catch (_) {
    /* ignore */
  }
});
try {
  applyBoardFont(localStorage.getItem('fh-board-font') || '14');
} catch (_) {
  applyBoardFont(14);
}

function loadLegFieldPrefs() {
  try {
    const vis = JSON.parse(localStorage.getItem('fh-leg-visible') || 'null');
    const bld = JSON.parse(localStorage.getItem('fh-leg-bold') || 'null');
    if (vis && typeof vis === 'object') {
      for (const [k] of LEG_FIELDS) {
        if (typeof vis[k] === 'boolean') state.fieldVisible[k] = vis[k];
      }
    }
    if (bld && typeof bld === 'object') {
      for (const [k] of LEG_FIELDS) {
        if (typeof bld[k] === 'boolean') state.fieldBold[k] = bld[k];
      }
    }
  } catch (_) {
    /* ignore */
  }
}

function saveLegFieldPrefs() {
  try {
    localStorage.setItem('fh-leg-visible', JSON.stringify(state.fieldVisible));
    localStorage.setItem('fh-leg-bold', JSON.stringify(state.fieldBold));
  } catch (_) {
    /* ignore */
  }
}

function initLegFieldsUi() {
  const root = document.getElementById('fh-fields');
  if (!root) return;
  loadLegFieldPrefs();
  root.innerHTML =
    `<div class="fh-fields-head"><span>Field</span><span>Show</span><span>Bold</span></div>` +
    LEG_FIELDS.map(
      ([key, label]) => `<label class="fh-fields-row">
        <span>${escapeHtml(label)}</span>
        <input type="checkbox" data-leg-vis="${key}" ${state.fieldVisible[key] ? 'checked' : ''} />
        <input type="checkbox" data-leg-bold="${key}" ${state.fieldBold[key] ? 'checked' : ''} />
      </label>`,
    ).join('');
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    const visKey = t.dataset.legVis;
    const boldKey = t.dataset.legBold;
    if (visKey) state.fieldVisible[visKey] = t.checked;
    if (boldKey) state.fieldBold[boldKey] = t.checked;
    saveLegFieldPrefs();
    render();
  });
}
initLegFieldsUi();

document.querySelectorAll('[data-sidebar]').forEach((btn) => {
  btn.addEventListener('click', () => {
    applySidebar(btn.dataset.sidebar);
    savePrefs();
  });
});
document.getElementById('fh-prev').addEventListener('click', goPrev);
document.getElementById('fh-next').addEventListener('click', goNext);
document.getElementById('loc-add')?.addEventListener('click', addLocalSailing);
document.getElementById('loc-new')?.addEventListener('click', () => clearLocForm());
document.getElementById('fh-local-open')?.addEventListener('click', () => {
  clearLocForm();
  syncLocalDatalists();
  document.getElementById('fh-local-dlg')?.showModal();
});

originsEl.addEventListener('change', async () => {
  updateListSelectionUi(originsEl);
  await loadConnections();
  await savePrefs();
});
destsEl.addEventListener('change', () => {
  updateListSelectionUi(destsEl);
  savePrefs();
  render();
});
vesselsEl.addEventListener('change', () => {
  updateListSelectionUi(vesselsEl);
  savePrefs();
  render();
});
companiesEl?.addEventListener('change', () => {
  updateListSelectionUi(companiesEl);
  render();
});
directionEl.addEventListener('change', () => {
  state.direction = directionEl.value;
  savePrefs();
  render(); // apply Show out/in immediately in every view
  loadSailings(); // then refresh cache slice for that direction
});

const filtersEl = document.getElementById('fh-filters');
const filtersScrim = document.getElementById('fh-filters-scrim');
const filtersToggle = document.getElementById('fh-filters-toggle');

// Tabs must not reflow the board (no fh-filters-collapsed width crush).
document.body.classList.remove('fh-filters-collapsed');

function setDrawerTab(tab) {
  const next = tab === 'display' ? 'display' : 'filters';
  document.querySelectorAll('.fh-side-tab').forEach((btn) => {
    const on = btn.dataset.tab === next;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const displayPanel = document.getElementById('fh-panel-display');
  const filtersPanel = document.getElementById('fh-panel-filters');
  if (displayPanel) displayPanel.hidden = next !== 'display';
  if (filtersPanel) filtersPanel.hidden = next !== 'filters';
  try {
    localStorage.setItem('fh_drawer_tab', next);
  } catch {
    /* ignore */
  }
  const head = document.querySelector('.fh-drawer-head strong');
  if (head) head.textContent = next === 'display' ? 'Display' : 'Filters';
}

function setFiltersOpen(open) {
  document.body.classList.toggle('fh-filters-open', !!open);
  filtersToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (filtersScrim) filtersScrim.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) {
    document.getElementById('fh-filters-close')?.focus?.();
  }
}

function closeFiltersDrawer() {
  setFiltersOpen(false);
}

filtersToggle?.addEventListener('click', () => {
  setFiltersOpen(!document.body.classList.contains('fh-filters-open'));
});
document.getElementById('fh-filters-close')?.addEventListener('click', closeFiltersDrawer);
filtersScrim?.addEventListener('click', closeFiltersDrawer);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && document.body.classList.contains('fh-filters-open')) {
    closeFiltersDrawer();
  }
});
document.querySelectorAll('.fh-side-tab').forEach((btn) => {
  btn.addEventListener('click', () => setDrawerTab(btn.dataset.tab));
});
try {
  setDrawerTab(localStorage.getItem('fh_drawer_tab') === 'display' ? 'display' : 'filters');
} catch {
  setDrawerTab('filters');
}

function enableDragScroll(el, { axes = 'x' } = {}) {
  if (!el || el.dataset.dragScrollBound === '1') return;
  el.dataset.dragScrollBound = '1';
  el.classList.add('fh-drag-scroll');
  const ax = axes === 'xy' || axes === 'both' ? 'xy' : axes === 'y' ? 'y' : 'x';
  let down = false;
  let activeId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startWinY = 0;
  let moved = false;
  const canY = () => el.scrollHeight > el.clientHeight + 1;
  const end = (ev) => {
    if (!down) return;
    if (ev && activeId != null && ev.pointerId != null && ev.pointerId !== activeId) return;
    down = false;
    const pid = activeId;
    activeId = null;
    el.classList.remove('is-dragging');
    document.body.classList.remove('fh-is-dragging');
    if (pid != null) {
      try {
        if (el.hasPointerCapture?.(pid)) el.releasePointerCapture(pid);
      } catch {
        /* ignore */
      }
    }
  };
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    if (ev.target.closest('a, button, input, select, textarea, label, summary, [data-pick], .fh-det, .fh-links')) return;
    // Innermost bound target owns the gesture (nested board/main/week).
    ev.stopPropagation();
    down = true;
    moved = false;
    activeId = ev.pointerId;
    startX = ev.clientX;
    startY = ev.clientY;
    startLeft = el.scrollLeft;
    startTop = el.scrollTop;
    startWinY = window.scrollY;
    try {
      el.setPointerCapture?.(ev.pointerId);
    } catch {
      /* ignore */
    }
  });
  el.addEventListener('pointermove', (ev) => {
    if (!down || (activeId != null && ev.pointerId !== activeId)) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      moved = true;
      el.classList.add('is-dragging');
      document.body.classList.add('fh-is-dragging');
    }
    if (!moved) return;
    if (ax.includes('x')) el.scrollLeft = startLeft - dx;
    if (ax.includes('y')) {
      if (canY()) el.scrollTop = startTop - dy;
      else window.scrollTo(0, startWinY - dy);
    }
  });
  // Document-level end: nested capture otherwise leaves parent `down` stuck.
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener(
    'click',
    (ev) => {
      if (moved) {
        ev.preventDefault();
        ev.stopPropagation();
        moved = false;
      }
    },
    true,
  );
}

function enableBoardDragScroll() {
  enableDragScroll(document.querySelector('.fh-view-strip'), { axes: 'x' });
  enableDragScroll(mainEl, { axes: 'xy' });
  const board = document.querySelector('.fh-board');
  if (board && board !== mainEl) enableDragScroll(board, { axes: 'xy' });
  for (const sel of ['.fh-week', '.fh-week-rows', '.fh-month', '.fh-vessel-week-grid']) {
    mainEl.querySelectorAll(sel).forEach((node) => enableDragScroll(node, { axes: 'x' }));
  }
}

function syncLocalDatalists() {
  const ports = document.getElementById('loc-port-list');
  const vessels = document.getElementById('loc-vessel-list');
  if (ports) {
    ports.innerHTML = state.ports
      .map((p) => `<option value="${escapeAttr(p.name)}"></option>`)
      .concat((state.dests || []).map((d) => `<option value="${escapeAttr(d.name)}"></option>`))
      .join('');
  }
  if (vessels) {
    vessels.innerHTML = state.vessels.map((n) => `<option value="${escapeAttr(n)}"></option>`).join('');
  }
}

/** Keep filter sticky offset under sticky nav + header (wraps on narrow widths). */
function syncStickyTop() {
  const nav = document.querySelector('.fh-page .app-nav');
  const top = document.querySelector('.fh-top');
  const navH = nav ? Math.ceil(nav.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--fh-nav-h', `${navH}px`);
  if (top) top.style.top = `${navH}px`;
  const topH = top ? Math.ceil(top.getBoundingClientRect().height) : 0;
  const h = navH + topH;
  if (h > 0) document.documentElement.style.setProperty('--fh-sticky-top', `${h}px`);
}

async function init() {
  applyStaticUi();
  applyBoardFit();
  enableDragScroll(document.querySelector('.fh-view-strip'));
  if (!dateEl.value) dateEl.value = todayISO();
  setStatus('Loading ports…');
  syncStickyTop();
  window.addEventListener('resize', syncStickyTop);
  dateEl.addEventListener('change', () => {
    savePrefs();
    loadSailings();
  });
  dateEndEl.addEventListener('change', () => {
    savePrefs();
    loadSailings();
  });
  try {
    await loadPorts();
    await loadConnections();
    await loadSailings();
  } catch (e) {
    setStatus(String(e.message || e), true);
  } finally {
    syncStickyTop();
  }
}

init();
