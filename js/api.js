/** Site-relative API URLs + static docs/data loaders (GH Pages). */

export function apiUrl(path) {
  const clean = String(path || '').replace(/^\//, '');
  return new URL(clean, new URL('.', location.href)).href;
}

export function isStaticHost() {
  return /\.github\.io$/i.test(location.hostname);
}

/** True when local manager API answers /api/health (Fetch / Clear / local edits). */
let _managerApi = null;

export async function probeManagerApi() {
  if (_managerApi !== null) return _managerApi;
  if (isStaticHost()) {
    _managerApi = false;
    return false;
  }
  try {
    const res = await fetch(apiUrl('api/health'), { cache: 'no-store' });
    if (!res.ok) {
      _managerApi = false;
      return false;
    }
    const data = await res.json();
    _managerApi = !!(data && (data.manager || data.ferryhopper_fetch || data.ok));
  } catch {
    _managerApi = false;
  }
  return _managerApi;
}

export function hasManagerApi() {
  return _managerApi === true;
}

/** Prefer short messages; never dump HTML error pages into the UI. */
export async function apiErrorMessage(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html') || res.status === 404) {
    return isStaticHost()
      ? 'No API on GitHub Pages — using published cache when available.'
      : 'API not found — Start server in the Python GUI, then Refresh.';
  }
  const t = await res.text();
  try {
    const j = JSON.parse(t);
    if (j.error) return j.error;
  } catch {
    /* not JSON */
  }
  if ((t || '').trimStart().startsWith('<!')) {
    return `API ${res.status} — Start server in the Python GUI, then Refresh.`;
  }
  return `API ${res.status}${t ? `: ${t.slice(0, 100)}` : ''}`;
}

export async function fetchJson(url, init) {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const text = await res.text();
  if ((text || '').trimStart().startsWith('<!')) {
    throw new Error(
      isStaticHost()
        ? 'No API on GitHub Pages — using published cache when available.'
        : 'API not found — Start server in the Python GUI, then Refresh.',
    );
  }
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON (${res.status})`);
  }
  if (!res.ok) throw new Error(data.error || `API ${res.status}`);
  return data;
}

/** Mirror porttracker.ferryhopper.origin_slug */
export function originSlug(origin) {
  const raw = String(origin || 'unknown').trim();
  // Published day/conn JSON uses rhodes, not Ferryhopper RODOS spelling.
  if (/^(rhodes|rhodos|rodos)$/i.test(raw)) return 'rhodes';
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'unknown';
}

export function dataUrl(name) {
  return apiUrl(`data/${String(name).replace(/^\//, '')}`);
}

export async function loadDataJson(name) {
  return fetchJson(dataUrl(name));
}

/** Try listed data filenames; return first that loads, else null. */
export async function loadDataFirst(names) {
  for (const name of names) {
    try {
      return await loadDataJson(name);
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function loadDayCache(origin, day, direction = 'out') {
  const slug = originSlug(origin);
  const names =
    direction === 'in'
      ? [`ferryhopper_in_${slug}_${day}.json`]
      : [`ferryhopper_${slug}_${day}.json`].concat(
          slug === 'rhodes' ? [`ferryhopper_${day}.json`] : [],
        );
  return loadDataFirst(names);
}

const RHODES_SATELLITES = ['SKALA KAMIROU(RHO)'];

function portKey(name) {
  const u = String(name || '').toUpperCase().trim();
  return (
    {
      RHODES: 'RODOS',
      RHODOS: 'RODOS',
      RODOS: 'RODOS',
      'SKALA KAMIROU(RHO)': 'SKALA KAMIROU(RHO)',
      'SKALA KAMIROU': 'SKALA KAMIROU(RHO)',
      'KAMIROS SKALA': 'SKALA KAMIROU(RHO)',
      'KAMEIROS SKALA': 'SKALA KAMIROU(RHO)',
    }[u] || u
  );
}

export function hubFetchOrigins(hub) {
  const h = (hub || 'Rhodes').trim() || 'Rhodes';
  const out = [h];
  if (portKey(h) === 'RODOS') {
    for (const sat of RHODES_SATELLITES) {
      if (!out.some((x) => portKey(x) === portKey(sat))) out.push(sat);
    }
  }
  return out;
}

function eachDay(from, to) {
  const start = from;
  const end = to || from;
  const days = [];
  const d0 = new Date(`${start}T12:00:00Z`);
  const d1 = new Date(`${end}T12:00:00Z`);
  for (let t = d0.getTime(); t <= d1.getTime(); t += 86400000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days.length ? days : [start];
}

/**
 * Assemble sailings from published day JSON (same idea as ferryhopper.load_range).
 * Does not merge local_sailings or annotate Via (caller / UI can).
 */
export async function loadStaticSailings({
  origins = ['Rhodes'],
  from,
  to,
  direction = 'both',
} = {}) {
  const hubs = origins.length ? origins : ['Rhodes'];
  const expanded = [];
  const seen = new Set();
  for (const hub of hubs) {
    for (const o of hubFetchOrigins(hub)) {
      const k = portKey(o);
      if (seen.has(k)) continue;
      seen.add(k);
      expanded.push(o);
    }
  }
  const dir = (direction || 'both').toLowerCase();
  const wantOut = dir === 'out' || dir === 'both' || dir === 'departures' || dir === 'dep';
  const wantIn = dir === 'in' || dir === 'both' || dir === 'arrivals' || dir === 'arr';
  const dayList = eachDay(from, to);
  const sailings = [];
  const missing = [];
  for (const day of dayList) {
    for (const origin of expanded) {
      if (wantOut) {
        const cached = await loadDayCache(origin, day, 'out');
        const key = `${origin}|${day}|out`;
        if (cached && cached.sailings != null) {
          for (const r of cached.sailings || []) {
            const row = { ...r, direction: r.direction || 'out' };
            if (portKey(origin) !== 'RODOS') row.pier = row.pier || origin;
            sailings.push(row);
          }
        } else {
          missing.push(key);
        }
      }
      if (wantIn) {
        const cached = await loadDayCache(origin, day, 'in');
        const key = `${origin}|${day}|in`;
        if (cached && cached.sailings != null) {
          for (const r of cached.sailings || []) {
            const row = { ...r, direction: 'in' };
            if (portKey(origin) !== 'RODOS') row.pier = row.pier || origin;
            sailings.push(row);
          }
        } else {
          missing.push(key);
        }
      }
    }
  }
  return {
    from: dayList[0],
    to: dayList[dayList.length - 1],
    origins: hubs,
    sailings,
    missing,
    present: [],
    static: true,
  };
}

export { portKey, RHODES_SATELLITES };
