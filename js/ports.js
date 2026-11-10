import {
  apiUrl,
  apiErrorMessage,
  fetchJson,
  isStaticHost,
  loadDataJson,
  loadStaticSailings,
  portKey,
} from './api.js';
import { openAbout } from './about.js';
import { PORTS as STATIC_PORTS } from './config.js';

const statusEl = document.getElementById('ports-status');
const hubEl = document.getElementById('ports-hub');
const tbody = document.querySelector('#ports-table tbody');
const hubsList = document.getElementById('ports-hubs');

let map;
let markers = [];
let facilities = [];
let readOnly = false;

const FACILITY_BY_OP = {
  bluestar: 'akandia',
  dodekanisos: 'akandia',
  anel: 'akandia',
  saos: 'akandia',
  seajets: 'tourist',
};

const OP_MATCH = [
  { id: 'bluestar', match: ['blue star', 'bluestar'] },
  { id: 'seajets', match: ['seajet', 'worldchampion', 'champion jet'] },
  { id: 'dodekanisos', match: ['dodekanisos', 'sebeco', 'panagia'] },
  { id: 'anel', match: ['kalymnos', 'anel'] },
  { id: 'saos', match: ['saos'] },
];

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function facilityName(id) {
  if (!id) return '';
  const p = facilities.find((f) => f.id === id);
  return p ? p.name : id;
}

function initMap() {
  if (map) return;
  map = L.map('ports-map').setView([36.43, 28.22], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 18,
  }).addTo(map);
}

function drawFacilities(list, highlightId) {
  markers.forEach((m) => m.remove());
  markers = [];
  facilities = list || [];
  const bounds = [];
  for (const p of facilities) {
    if (p.lat == null || p.lon == null) continue;
    const isHi = highlightId && p.id === highlightId;
    const m = L.circleMarker([p.lat, p.lon], {
      radius: isHi ? 10 : 7,
      color: isHi ? '#c45c26' : '#0a3d4a',
      fillColor: isHi ? '#c45c26' : '#146377',
      fillOpacity: 0.85,
      weight: 2,
    })
      .bindPopup(`<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(p.role || '')}`)
      .addTo(map);
    markers.push(m);
    bounds.push([p.lat, p.lon]);
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
}

function suggestFacility(operator, origin) {
  const o = String(origin || '').toUpperCase();
  if (o.includes('KAMIROU') || o.includes('KAMIROS') || o.includes('SKALA')) return 'kamiros';
  const opL = String(operator || '').toLowerCase();
  for (const op of OP_MATCH) {
    if (op.match.some((m) => m && opL.includes(m))) return FACILITY_BY_OP[op.id] || '';
  }
  return '';
}

function hubKeys(hub) {
  const k = portKey(hub || 'Rhodes');
  const set = new Set([k]);
  if (k === 'RODOS') {
    set.add(portKey('SKALA KAMIROU(RHO)'));
  }
  return set;
}

function isoDayOffset(base, days) {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Client-side mirror of vessel_ports.vessel_table for static Pages. */
async function buildStaticVesselTable(hub) {
  const today = new Date().toISOString().slice(0, 10);
  const from = isoDayOffset(today, -7);
  const to = isoDayOffset(today, 60);
  const data = await loadStaticSailings({
    origins: [hub || 'Rhodes'],
    from,
    to,
    direction: 'out',
  });
  let overrides = {};
  try {
    const raw = await loadDataJson('vessel_ports.json');
    overrides = (raw && raw.vessels) || {};
  } catch {
    overrides = {};
  }
  const hubs = hubKeys(hub);
  const byVessel = new Map();
  for (const r of data.sailings || []) {
    if (!hubs.has(portKey(r.origin))) continue;
    const vessel = String(r.vessel || '').trim() || '—';
    let slot = byVessel.get(vessel);
    if (!slot) {
      slot = {
        vessel,
        operator: r.operator || '',
        origins: new Map(),
        dests: new Map(),
        n: 0,
      };
      byVessel.set(vessel, slot);
    }
    if (!slot.operator && r.operator) slot.operator = r.operator;
    const orig = r.origin || '—';
    slot.origins.set(orig, (slot.origins.get(orig) || 0) + 1);
    const dest = String(r.dest || '').trim();
    if (dest) slot.dests.set(dest, (slot.dests.get(dest) || 0) + 1);
    slot.n += 1;
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const vessels = [...byVessel.values()]
    .sort((a, b) => a.vessel.localeCompare(b.vessel, undefined, { sensitivity: 'base' }))
    .map((slot) => {
      const originTop = top(slot.origins)[0] || '';
      const suggested = suggestFacility(slot.operator, originTop);
      const leave = overrides[slot.vessel] || suggested;
      return {
        vessel: slot.vessel,
        operator: slot.operator,
        leave_hub: originTop,
        leave_facility: leave,
        suggested_facility: suggested,
        leave_facility_source: overrides[slot.vessel]
          ? 'override'
          : suggested && leave === suggested
            ? 'seed'
            : '',
        dests: top(slot.dests).slice(0, 12),
        n: slot.n,
      };
    });
  return {
    facilities: STATIC_PORTS.map((p) => ({
      id: p.id,
      name: p.name,
      name_el: p.name_el || '',
      role: p.role || '',
      lat: p.lat,
      lon: p.lon,
    })),
    vessels,
    missing: data.missing || [],
    static: true,
  };
}

async function loadHubs() {
  try {
    let data;
    if (isStaticHost()) {
      data = await loadDataJson('ferryhopper_ports.json');
    } else {
      try {
        data = await fetchJson(apiUrl('api/ferryhopper/ports?country=Greece'));
      } catch {
        data = await loadDataJson('ferryhopper_ports.json');
      }
    }
    const names = (data.ports || []).map((p) => p.name || p).filter(Boolean);
    hubsList.innerHTML = names
      .slice(0, 80)
      .map((n) => `<option value="${escapeHtml(n)}"></option>`)
      .join('');
  } catch (_) {
    /* ignore */
  }
}

function facilityOptions(selected) {
  const opts = [`<option value="">Auto (seed)</option>`].concat(
    facilities.map(
      (p) =>
        `<option value="${escapeHtml(p.id)}"${p.id === selected ? ' selected' : ''}>${escapeHtml(
          p.name,
        )}</option>`,
    ),
  );
  return opts.join('');
}

async function saveFacility(vessel, leave_facility) {
  if (readOnly) return;
  setStatus(leave_facility ? `Saving ${vessel}…` : `Resetting ${vessel}…`);
  const res = await fetch(apiUrl('api/ferryhopper/vessel-ports'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vessel, leave_facility, origin: hubEl.value || 'Rhodes' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  drawFacilities(data.facilities || facilities, leave_facility || undefined);
  renderTable(data.vessels || []);
  setStatus(
    `${(data.vessels || []).length} vessels · ` +
      (leave_facility ? 'override saved' : 'reset to auto'),
  );
}

function renderTable(rows) {
  tbody.innerHTML = rows
    .map((r) => {
      const dests = (r.dests || []).slice(0, 8).join(', ');
      const isOverride = r.leave_facility_source === 'override';
      const autoLabel = facilityName(r.suggested_facility);
      let hint = '';
      if (isOverride) {
        hint = autoLabel
          ? ` <span class="muted">(override · auto: ${escapeHtml(autoLabel)})</span>`
          : ` <span class="muted">(override)</span>`;
      } else if (r.leave_facility_source === 'seed') {
        hint = ` <span class="muted">(seed)</span>`;
      }
      const resetBtn =
        !readOnly && isOverride
          ? ` <button type="button" class="ghost ports-reset" data-vessel="${escapeHtml(
              r.vessel,
            )}">Reset</button>`
          : '';
      const selected = r.leave_facility || '';
      const dis = readOnly ? ' disabled' : '';
      return `<tr data-vessel="${escapeHtml(r.vessel)}">
        <td><strong>${escapeHtml(r.vessel)}</strong></td>
        <td>${escapeHtml(r.operator || '—')}</td>
        <td>${escapeHtml(r.leave_hub || '—')}</td>
        <td class="ports-fac-cell"><select class="ports-fac" data-vessel="${escapeHtml(
          r.vessel,
        )}"${dis}>${facilityOptions(selected)}</select>${hint}${resetBtn}</td>
        <td class="ports-dests">${escapeHtml(dests || '—')}</td>
        <td>${r.n || 0}</td>
      </tr>`;
    })
    .join('');

  if (readOnly) return;

  tbody.querySelectorAll('.ports-fac').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await saveFacility(sel.dataset.vessel, sel.value);
      } catch (e) {
        setStatus(`Save failed: ${e.message || e}`);
      }
    });
    sel.addEventListener('focus', () => drawFacilities(facilities, sel.value));
  });

  tbody.querySelectorAll('.ports-reset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await saveFacility(btn.dataset.vessel, '');
      } catch (e) {
        setStatus(`Reset failed: ${e.message || e}`);
      }
    });
  });
}

async function load() {
  initMap();
  const hub = hubEl.value.trim() || 'Rhodes';
  setStatus(`Loading ${hub}…`);
  readOnly = false;
  try {
    if (!isStaticHost()) {
      const res = await fetch(
        apiUrl(`api/ferryhopper/vessel-ports?origin=${encodeURIComponent(hub)}&days=60`),
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      drawFacilities(data.facilities || []);
      renderTable(data.vessels || []);
      const miss = (data.missing || []).length;
      setStatus(
        `${(data.vessels || []).length} vessels` +
          (miss ? ` · ${miss} cache files still missing for range` : ''),
      );
      return;
    }
  } catch (e) {
    /* fall through to static table */
    if (!isStaticHost()) {
      // API down locally — still show cache-backed read-only table
    }
  }
  try {
    const data = await buildStaticVesselTable(hub);
    readOnly = true;
    drawFacilities(data.facilities || STATIC_PORTS);
    renderTable(data.vessels || []);
    const miss = (data.missing || []).length;
    const where = isStaticHost() ? 'read-only on GitHub Pages' : 'read-only (no API)';
    setStatus(
      `${(data.vessels || []).length} vessels · ${where}` +
        (miss ? ` · ${miss} day files missing from cache` : ''),
    );
  } catch (e2) {
    readOnly = true;
    drawFacilities(STATIC_PORTS);
    renderTable([]);
    setStatus(String(e2.message || e2));
  }
}

document.getElementById('ports-reload')?.addEventListener('click', load);
hubEl?.addEventListener('change', load);
document.getElementById('about-btn')?.addEventListener('click', () => {
  openAbout({
    desc: isStaticHost()
      ? 'Ports & vessels map from the published cache (GitHub Pages is read-only).'
      : 'Ports & vessels map — facility overrides save to the shared docs/data cache.',
    showQr: true,
  });
});
loadHubs();
load();
