/** Shared Events-style About panel (Email / GitHub / blurb / optional QR). */

const AUTHOR_EMAIL = 'alexofrhodes@gmail.com';
const AUTHOR_GITHUB = 'https://github.com/alexofrhodes';
const AUTHOR_GITHUB_LABEL = 'github.com/alexofrhodes';
const SITE_QR_SRC = './icons/site-qr.png';

/**
 * @param {{ desc: string, showQr?: boolean }} opts
 * showQr: true on website About (scan / share site); false when omitted for a surface.
 */
export function openAbout({ desc, showQr = true } = {}) {
  let root = document.getElementById('rpa-about');
  if (!root) {
    root = document.createElement('div');
    root.id = 'rpa-about';
    root.className = 'about hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'About');
    root.innerHTML = `
      <div class="about-backdrop" data-about-close></div>
      <div class="about-panel">
        <button type="button" class="about-close" data-about-close aria-label="Close">×</button>
        <p class="about-kicker">About</p>
        <div class="about-group">
          <div class="about-row">
            <span class="about-label">Email</span>
            <a class="about-value" href="mailto:${AUTHOR_EMAIL}">${AUTHOR_EMAIL}</a>
          </div>
          <div class="about-row">
            <span class="about-label">GitHub</span>
            <a class="about-value" href="${AUTHOR_GITHUB}" target="_blank" rel="noopener">${AUTHOR_GITHUB_LABEL}</a>
          </div>
        </div>
        <p class="about-desc" data-about-desc></p>
        <div class="about-qr" data-about-qr hidden>
          <p class="about-qr-caption">Scan to open site</p>
          <img src="${SITE_QR_SRC}" width="96" height="96" alt="QR code for this site" />
        </div>
      </div>`;
    document.body.appendChild(root);
    const close = () => root.classList.add('hidden');
    root.querySelectorAll('[data-about-close]').forEach((el) => el.addEventListener('click', close));
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !root.classList.contains('hidden')) close();
    });
  }
  const descEl = root.querySelector('[data-about-desc]');
  if (descEl) descEl.textContent = desc || '';
  const qr = root.querySelector('[data-about-qr]');
  if (qr) qr.hidden = !showQr;
  root.classList.remove('hidden');
}
