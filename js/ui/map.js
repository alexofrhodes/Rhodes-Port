import { CENTER, PORTS } from '../config.js';

const SHIP_COLOR = '#0b6e4f';
const PORT_COLOR = '#8b5e34';

function triangleIcon(color, heading) {
  const rot = Number(heading) || 0;
  return L.divIcon({
    className: 'marker-tri',
    html: `<div style="transform:rotate(${rot}deg);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:16px solid ${color};filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"></div>`,
    iconSize: [14, 16],
    iconAnchor: [7, 10],
  });
}

function pinIcon(color) {
  return L.divIcon({
    className: 'marker-pin',
    html: `<span style="display:block;width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

export function createMap(el) {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(
    [CENTER.lat, CENTER.lon],
    CENTER.zoom,
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  }).addTo(map);

  const anchors = L.layerGroup().addTo(map);
  const live = L.layerGroup().addTo(map);
  const markers = new Map();

  for (const p of PORTS) {
    L.marker([p.lat, p.lon], { icon: pinIcon(PORT_COLOR) })
      .bindPopup(`<strong>${p.name}</strong><br>${p.role}`)
      .addTo(anchors);
  }

  function setRows(rows, mode, onSelect) {
    live.clearLayers();
    markers.clear();
    const color = SHIP_COLOR;
    for (const r of rows) {
      if (r._scheduleOnly || r.status === 'directory') continue;
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
      const m = L.marker([r.lat, r.lon], { icon: triangleIcon(color, r.heading) });
      m.bindPopup(`<strong>${r.name}</strong><br>${r.status}${r.to ? ` → ${r.to}` : ''}`);
      m.on('click', () => onSelect?.(r.id));
      m.addTo(live);
      markers.set(r.id, m);
    }
  }

  function select(id) {
    const m = markers.get(id);
    if (!m) return;
    map.panTo(m.getLatLng());
    m.openPopup();
  }

  function fitLive() {
    const layers = live.getLayers();
    if (!layers.length) return;
    const g = L.featureGroup(layers);
    map.fitBounds(g.getBounds().pad(0.2));
  }

  return {
    map,
    setRows,
    select,
    fitLive,
    invalidate() {
      setTimeout(() => map.invalidateSize(), 50);
    },
  };
}
