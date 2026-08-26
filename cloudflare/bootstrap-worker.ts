export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "bootstrapping",
        service: "Google Drive Migrator",
        runtime: "cloudflare-workers-free",
      });
    }

    return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Google Drive Migrator</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a}
    main{max-width:680px;padding:48px;text-align:center}
    h1{font-size:clamp(2rem,6vw,4rem);margin:0 0 16px}
    p{font-size:1.05rem;line-height:1.65;color:#475569}
    code{background:#e2e8f0;border-radius:8px;padding:4px 8px}
  </style>
</head>
<body><main><h1>Google Drive Migrator</h1><p>Cloudflare deployment is live. The full zero-cost migration runtime is being wired to this Worker.</p><p><code>/api/health</code> is available for deployment verification.</p></main></body>
</html>`, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
} satisfies ExportedHandler;
