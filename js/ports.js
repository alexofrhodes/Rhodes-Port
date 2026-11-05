const statusEl = document.getElementById('ports-status');
const hubEl = document.getElementById('ports-hub');
const tbody = document.querySelector('#ports-table tbody');
const hubsList = document.getElementById('ports-hubs');

let map;
let markers = [];
let facilities = [];

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

async function loadHubs() {
  try {
    const res = await fetch('/api/ferryhopper/ports?country=Greece', { cache: 'no-store' });
    const data = await res.json();
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
  setStatus(leave_facility ? `Saving ${vessel}…` : `Resetting ${vessel}…`);
  const res = await fetch('/api/ferryhopper/vessel-ports', {
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
      const resetBtn = isOverride
        ? ` <button type="button" class="ghost ports-reset" data-vessel="${escapeHtml(
            r.vessel,
          )}">Reset</button>`
        : '';
      // Select shows effective facility; Auto only when nothing effective.
      const selected = r.leave_facility || '';
      return `<tr data-vessel="${escapeHtml(r.vessel)}">
        <td><strong>${escapeHtml(r.vessel)}</strong></td>
        <td>${escapeHtml(r.operator || '—')}</td>
        <td>${escapeHtml(r.leave_hub || '—')}</td>
        <td class="ports-fac-cell"><select class="ports-fac" data-vessel="${escapeHtml(
          r.vessel,
        )}">${facilityOptions(selected)}</select>${hint}${resetBtn}</td>
        <td class="ports-dests">${escapeHtml(dests || '—')}</td>
        <td>${r.n || 0}</td>
      </tr>`;
    })
    .join('');

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
  try {
    const res = await fetch(
      `/api/ferryhopper/vessel-ports?origin=${encodeURIComponent(hub)}&days=60`,
      { cache: 'no-store' },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    drawFacilities(data.facilities || []);
    renderTable(data.vessels || []);
    const miss = (data.missing || []).length;
    setStatus(
      `${(data.vessels || []).length} vessels` +
        (miss ? ` · ${miss} cache files still missing for range` : ''),
    );
  } catch (e) {
    setStatus(`Failed: ${e.message || e}`);
  }
}

document.getElementById('ports-reload')?.addEventListener('click', load);
hubEl?.addEventListener('change', load);
document.getElementById('about-btn')?.addEventListener('click', () => {
  alert(
    'Rhodes Port Tracker — Ports & vessels.\n\n' +
      'Alex of Rhodes\n' +
      'alexofrhodes@gmail.com\n' +
      'https://github.com/alexofrhodes\n\n' +
      'Facility overrides save to docs/data/vessel_ports.json (shared with the GUI).',
  );
});
loadHubs();
load();
