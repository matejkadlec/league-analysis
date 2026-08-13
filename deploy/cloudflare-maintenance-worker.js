// Authoritative source for the Cloudflare Worker `league-analysis-maintenance`
// (account Mhovadik@gmail.com, zone leagueanalysis.gg). The Worker runs on the
// routes `dev.leagueanalysis.gg/*` and `api-dev.leagueanalysis.gg/*`, passes
// every request through to the tunnel origin, and serves a branded maintenance
// response only when the origin is unreachable or answers with a gateway
// error. After editing this file, redeploy the Worker from it; the dashboard
// copy is a deployment target, not a second source.
//
// See docs/deployment.md#edge-maintenance-fallback-cloudflare.

const ORIGIN_DOWN_STATUSES = new Set([502, 504, 521, 522, 523, 525, 526, 530]);

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Maintenance | League Analysis</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
:root { --navy-base: #0a1428; --navy-darkest: #00091a; --navy-light: #2c3e6f; --gold-base: #cfa93a; --gold-light: #fcb305; --foreground: #fafafa; --muted: #9aa4b2; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--navy-darkest); color: var(--foreground); font-family: "Montserrat", system-ui, sans-serif; padding: 1.5rem; }
.card { background: var(--navy-base); border: 1px solid var(--navy-light); border-radius: 0.5rem; padding: 3rem 2.5rem; max-width: 28rem; text-align: center; }
.badge { display: inline-block; border: 1px solid var(--gold-base); border-radius: 9999px; color: var(--gold-base); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.35rem 0.9rem; margin-bottom: 1.5rem; }
h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; }
h1 span { color: var(--gold-base); }
p { color: var(--muted); font-size: 0.95rem; line-height: 1.6; }
.spinner { margin: 1.75rem auto 0; width: 2rem; height: 2rem; border: 3px solid var(--navy-light); border-top-color: var(--gold-light); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
<meta http-equiv="refresh" content="30" />
</head>
<body>
<main class="card">
<div class="badge">Maintenance</div>
<h1><span>League</span> Analysis</h1>
<p>We are deploying an update. The site will be back in a moment &mdash; this page refreshes automatically.</p>
<div class="spinner" aria-hidden="true"></div>
</main>
</body>
</html>`;

function maintenanceResponse(request) {
  const accept = request.headers.get("Accept") || "";
  if (accept.includes("text/html")) {
    return new Response(PAGE, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": "30",
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(
    JSON.stringify({ detail: "Maintenance in progress. Retry shortly." }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "30",
        "Cache-Control": "no-store",
      },
    },
  );
}

export default {
  async fetch(request) {
    let response;
    try {
      response = await fetch(request);
    } catch {
      return maintenanceResponse(request);
    }
    if (ORIGIN_DOWN_STATUSES.has(response.status)) {
      return maintenanceResponse(request);
    }
    return response;
  },
};
