/** Hide Live nav on static hosts (no AIS API). */
import { isStaticHost } from './api.js';

document.querySelectorAll('a[data-nav-live]').forEach((a) => {
  if (isStaticHost()) a.hidden = true;
});
