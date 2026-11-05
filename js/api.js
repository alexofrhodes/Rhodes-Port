/** Site-relative API URLs (works under /Rhodes-Port/ on GitHub Pages). */

export function apiUrl(path) {
  const clean = String(path || '').replace(/^\//, '');
  return new URL(clean, new URL('.', location.href)).href;
}

export function isStaticHost() {
  return /\.github\.io$/i.test(location.hostname);
}

/** Prefer short messages; never dump HTML error pages into the UI. */
export async function apiErrorMessage(res) {
  if (isStaticHost() || res.status === 404) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html') || res.status === 404) {
      return isStaticHost()
        ? 'Live AIS needs the local Port Tracker server (GitHub Pages has no API).'
        : 'API not found — Start server in the Python GUI, then Refresh.';
    }
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
