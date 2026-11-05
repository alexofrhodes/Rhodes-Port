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

export const PORTS = [
  {
    id: 'akandia',
    name: 'Port of Akandia',
    role: 'Passenger & commercial ferries',
    lat: 36.433,
    lon: 28.24,
    website: 'https://www.litando.gr/rhodes/',
    contact: 'Municipal Port Fund of South Dodecanese',
    notes: 'Main ferry terminal — Piraeus, Crete, Dodecanese, Cyclades.',
    book: 'https://www.ferryhopper.com/en/ferries/greece/rhodes',
  },
  {
    id: 'tourist',
    name: 'Tourist Port of Rhodes',
    role: 'Cruise & Turkey routes',
    lat: 36.445,
    lon: 28.23,
    website: 'https://www.litando.gr/rhodes/',
    contact: 'Municipal Port Fund of South Dodecanese',
    notes: 'Cruise berths; summer links to Marmaris, Datça, Fethiye.',
    book: 'https://www.ferryhopper.com/en/ferries/greece/rhodes',
  },
  {
    id: 'mandraki',
    name: 'Mandraki Marina',
    role: 'Marina / small craft',
    lat: 36.451,
    lon: 28.227,
    website: 'https://www.litando.gr/rhodes/',
    contact: 'Mandraki Port Authority',
    notes: 'Historic harbour by the Old Town / Deer statues.',
    book: null,
  },
  {
    id: 'kamiros',
    name: 'Kamiros Skala',
    role: 'West-coast ferry pier',
    lat: 36.273,
    lon: 27.807,
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
