/** Ships API client — keeps last good payload on failure. Search is client-side only. */

let lastGood = null;

export async function fetchShips({ refresh = false, ports = '', rhodesOnly = true, noCruise = false, starred = false } = {}) {
  const params = new URLSearchParams({
    refresh: refresh ? '1' : '0',
    ports,
    rhodes_only: rhodesOnly ? '1' : '0',
    no_cruise: noCruise ? '1' : '0',
    starred: starred ? '1' : '0',
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(`/api/ships?${params}`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Ships API ${res.status}${t ? `: ${t.slice(0, 120)}` : ''}`);
    }
    const body = await res.json();
    if (body.error) throw new Error(body.error);
    const rows = (body.rows || []).map((r) => ({
      id: String(r.mmsi || `${r.lat},${r.lon}`),
      mode: 'ship',
      name: r.name,
      callsignOrMmsi: r.mmsi,
      type: r.type,
      class: r.class,
      status: r.status,
      lat: r.lat,
      lon: r.lon,
      heading: r.cog,
      speed: r.sog,
      to: r.dest,
      dest: r.dest,
      eta: r.eta,
      portName: r.port,
      port: r.port,
      portId: r.port_id,
      draught: r.draught,
      length: r.length,
      flag: r.flag,
      imo: r.imo,
      callsign: r.callsign,
      distKm: r.km,
      km: r.km,
      seen: r.seen,
      source: r.source,
      will_dock: r.will_dock,
      rhodes_bound: r.rhodes_bound,
      sog: r.sog,
      cog: r.cog,
      mmsi: r.mmsi,
      starred: !!r.starred,
      operator: r.operator || '',
      operator_url: r.operator_url || '',
      operator_schedules: r.operator_schedules || '',
      operator_contact: r.operator_contact || '',
      will_dock: !!r.will_dock,
      fleet_track: !!r.fleet_track,
      likely_port: r.likely_port || '',
      port_guess: !!r.port_guess,
      note: r.note || '',
      links: r.links || '',
      note_key: r.note_key || '',
    }));
    lastGood = { ...body, rows };
    return lastGood;
  } catch (e) {
    if (lastGood) {
      return { ...lastGood, stale: true, error_kept: String(e.message) };
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
