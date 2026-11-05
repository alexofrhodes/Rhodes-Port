/** Rhodes geographic anchors and poll settings */

export const BRAND = 'Rhodes Port Tracker';

export const CENTER = { lat: 36.43, lon: 28.22, zoom: 11 };

export const SHIPS = {
  lat: 36.445,
  lon: 28.23,
  radiusKm: 35,
  pollMs: 45_000,
  bbox: { minLat: 36.2, minLon: 27.7, maxLat: 36.55, maxLon: 28.35 },
};

/** Keep in sync with porttracker/ports.py (OSM harbour nodes). */
export const PORTS = [
  {
    id: 'akandia',
    name: 'Akandia',
    name_el: 'Ακαντιά',
    role: 'Passenger & commercial ferries',
    // OSM Εμπορικό Λιμάνι — not Νέα Μαρίνα (~36.434, 28.239 further south)
    lat: 36.442427,
    lon: 28.236895,
    website: 'https://www.litando.gr/rhodes/',
    contact: 'Municipal Port Fund of South Dodecanese',
    notes: 'Main ferry terminal — Piraeus, Crete, Dodecanese, Cyclades.',
    book: 'https://www.ferryhopper.com/en/ferries/greece/rhodes',
  },
  {
    id: 'kolona',
    name: 'Kolona Harbour',
    name_el: 'Κολώνα',
    role: 'Passenger / high-speed local',
    lat: 36.445767,
    lon: 28.228861,
    website: 'https://www.litando.gr/rhodes/',
    contact: 'Municipal Port Fund of South Dodecanese',
    notes: 'Sebeco, Dodekanisos Express & Pride.',
    book: 'https://www.ferryhopper.com/en/ferries/greece/rhodes',
  },
  {
    id: 'tourist',
    name: 'Tourist Port',
    name_el: 'Τουριστικό λιμάνι',
    role: 'Cruise & Turkey routes',
    lat: 36.444331,
    lon: 28.232055,
    website: 'https://www.litando.gr/rhodes/',
    contact: 'Municipal Port Fund of South Dodecanese',
    notes: 'Cruise berths; summer links to Marmaris, Datça, Fethiye.',
    book: 'https://www.ferryhopper.com/en/ferries/greece/rhodes',
  },
  {
    id: 'mandraki',
    name: 'Mandraki',
    name_el: 'Μανδράκι',
    role: 'Marina / small craft',
    lat: 36.44887,
    lon: 28.22593,
    website: 'https://www.litando.gr/rhodes/',
    contact: 'Mandraki Port Authority',
    notes: 'Historic harbour by the Old Town / Deer statues.',
    book: null,
  },
  {
    id: 'kamiros',
    name: 'Kamiros Skala',
    name_el: 'Κάμειρος Σκάλα',
    role: 'West-coast ferry pier',
    lat: 36.2728,
    lon: 27.8249,
    website: 'https://www.litando.gr/rhodes/',
    contact: 'Kamiros Skala terminal',
    notes: 'Regular links to Halki (and seasonal nearby islands).',
    book: 'https://www.ferryhopper.com/en/ferries/greece/rhodes',
  },
];

export const OPERATORS = [
  { name: 'Blue Star Ferries', mode: 'ship', url: 'https://www.bluestarferries.com/' },
  { name: 'SeaJets', mode: 'ship', url: 'https://www.seajets.gr/' },
  { name: 'Dodekanisos Seaways', mode: 'ship', url: 'https://www.12ne.gr/' },
  { name: 'Ferryhopper (compare fares)', mode: 'ship', url: 'https://www.ferryhopper.com/en/ferries/greece/rhodes' },
];

/** Haversine distance in km */
export function distKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function nearestPort(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const p of PORTS) {
    const d = distKm(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { port: best, km: bestD };
}
