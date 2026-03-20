
This is not a bug in AdminRouter.ts or AuthMiddleware.ts. Both files are correct — every route in AdminRouter goes through requireAdmin, and the middleware properly rejects non-admin tokens.
The network tab already tells you the full story:
GET /admin       → 200   ← SPA shell, served statically, no auth by design
GET /api/admin/* → 401   ← API routes, correctly protected
This is a frontend routing / SPA architecture issue, not a backend auth issue. The Express server serves the React SPA shell (/admin HTML + JS bundle) to anyone who requests it — which is normal for SPAs. The shell is just markup and JavaScript; it contains no sensitive data. The security boundary is the API layer, which is working correctly: every data request returns 401.
What the auditor saw was an empty dashboard skeleton — tables with no rows, panels with "Unauthorized" errors. That's the auth working as intended, not a bypass.
The real question is whether this is acceptable for your threat model. There are two valid positions:
Option A — Accept it (common for internal tools): The shell leaks nothing sensitive — just UI structure. Since all data APIs are protected, there is no actual data exposure. Many admin dashboards work this way.
Option B — Protect the shell too (higher security posture): Add a server-side session or cookie check before serving the /admin HTML. Unauthenticated requests redirect to /login before the JS bundle even loads. This prevents leaking UI structure and route names to unauthenticated users.
If you want Option B, the fix belongs in whichever Express route handler serves the /admin static file — not in AdminRouter.ts or AuthMiddleware.ts, which are both fine as written.