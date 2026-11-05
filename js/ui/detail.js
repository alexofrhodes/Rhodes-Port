export function createDetail(root) {
  function render(row) {
    if (!row) {
      root.innerHTML = `<p class="detail-empty">Select a row or map marker.</p>`;
      return;
    }
    const fields = [
      ['Status', row.status],
      ['Class', row.class],
      ['Type', row.type],
      ['Operator', row.operator],
      ['Contact', row.operator_contact],
      ['Flag', row.flag],
      ['MMSI', row.callsignOrMmsi || row.mmsi],
      ['IMO', row.imo],
      ['Callsign', row.callsign],
      ['Port / approach', row.portName || row.port],
      ['Likely berth', row.likely_port],
      ['Will dock', row.will_dock ? 'yes' : 'no'],
      ['Note', row.note],
      ['Destination', row.to || row.dest],
      ['ETA', row.eta],
      ['SOG (kn)', row.speed ?? row.sog],
      ['COG', row.heading ?? row.cog],
      ['Length (m)', row.length],
      ['Draught', row.draught],
      ['Lat', row.lat],
      ['Lon', row.lon],
      ['Distance (km)', row.distKm ?? row.km],
      ['Last seen', row.seen],
      ['AIS source', row.source],
    ];

    const links = [];
    if (row.operator_url) links.push(`<a href="${escape(row.operator_url)}" target="_blank" rel="noopener">Operator site</a>`);
    if (row.operator_schedules) links.push(`<a href="${escape(row.operator_schedules)}" target="_blank" rel="noopener">Schedules</a>`);
    for (const it of parseUserLinks(row.links || '')) {
      links.push(`<a href="${escape(it.url)}" target="_blank" rel="noopener">${escape(it.label)}</a>`);
    }

    root.innerHTML = `
      <h2>${escape(row.name)}</h2>
      <dl class="detail-grid">
        ${fields
          .map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v == null || v === '' ? '—' : String(v))}</dd></div>`)
          .join('')}
      </dl>
      ${links.length ? `<p class="detail-links">${links.join(' · ')}</p>` : ''}
      ${
        row.port_guess
          ? `<p class="detail-hint">Berth is a likely guess (operator/route/approach) — AIS has not confirmed the pier yet.</p>`
          : row.mode === 'ship' && (row.portName || row.port) === 'Rhodes (inbound)'
            ? `<p class="detail-hint">Berth name shown only when AIS position is inside that pier’s radius — not nearest-port guess.</p>`
            : ''
      }
    `;
  }

  render(null);
  return { render };
}

function parseUserLinks(text) {
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

function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
