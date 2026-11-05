# Rhodes Port Tracker — site

Nested git repo (publish separately from the manager).

## Layout

| Path | What |
|------|------|
| `*.html`, `css/`, `js/`, `icons/`, `sw.js` | Static PWA / planner |
| `data/` | Ferryhopper day cache JSON + `local_sailings.json` + vessel overrides |

HTML and JSON are **not** mixed in one directory: pages at site root, cache only under `data/`.

## Serve

From the manager root:

```bash
python main.py --headless
# http://127.0.0.1:8787/ferries.html
# http://127.0.0.1:8787/ports.html
```

Do not commit secrets or sqlite here.
