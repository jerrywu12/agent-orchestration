// The sole offline content is this public explanation, mirrored in offline.html.
// Never use CacheStorage: operational HTML, assets, API data and credentials must
// always come from the running service. Tests keep the explanation copies equal.
const OFFLINE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f7f8f6" />
    <title>Agent Desk — service unavailable</title>
    <style>
      body {
        margin: 0;
        background: #f7f8f6;
        color: #27352a;
        font:
          17px/1.6 system-ui,
          sans-serif;
      }
      main {
        max-width: 32rem;
        margin: 12vh auto;
        padding: 2rem;
      }
      h1 {
        font-size: 1.8rem;
        line-height: 1.2;
      }
      a {
        display: inline-block;
        margin-top: 1rem;
        padding: 0.65rem 1rem;
        border-radius: 0.5rem;
        background: #315d40;
        color: white;
        text-decoration: none;
      }
      a:focus-visible {
        outline: 3px solid #315d40;
        outline-offset: 4px;
      }
    </style>
  </head>
  <body>
    <main>
      <p>Agent Desk</p>
      <h1>The local service is unavailable</h1>
      <p>
        Agent Desk needs its local service to load your workspace. Check that
        the service is running on this computer, then try again.
      </p>
      <p>
        This offline page contains no workspace data. Ticket updates and agent
        actions are unavailable here; no changes are queued.
      </p>
      <a href="/">Try again</a>
    </main>
  </body>
</html>`;

// Immediate takeover is safe because no app resources are cached and no open
// window is reloaded. A deployment must not interrupt unsaved ticket drafts.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    request.mode !== "navigate" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  event.respondWith(
    fetch(request, { cache: "no-store" }).catch(
      () =>
        new Response(OFFLINE_HTML, {
          status: 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            "X-Content-Type-Options": "nosniff",
          },
        }),
    ),
  );
});
