## Environment
- Node 20.11, pnpm 8.15, macOS 14.3
- React 18.2 SPA frontend, Express API backend
- Reported by a security auditor after PR #601 ("launch admin dashboard")

## Symptom
The admin dashboard is accessible without authentication. Navigating to
`/admin` in the browser renders the full admin dashboard UI including
user management tables and system settings — without any login prompt.

A security auditor flagged this during a review and marked it as a
critical vulnerability. They were able to see the admin interface layout,
navigation menus, and form fields without providing any credentials.

However, when they attempted to load actual data — clicking any section
that fetches from the API — all requests returned 401 Unauthorized. The
dashboard rendered but showed empty tables and "Unauthorized" error messages
in every data panel.

I believe the issue is in `AdminRouter.ts`. The middleware may only be
applied to some routes and not others, or there may be a route that serves
the admin HTML without going through `AuthMiddleware`. The fact that the
UI renders at all without a token suggests at least one endpoint is
unprotected.

## Stack trace
No crash. Admin dashboard renders client-side.
All subsequent API calls return 401.
Network tab shows: GET /admin → 200 (SPA shell, no auth required by design)
                   GET /api/admin/users → 401

## What I tried
- Navigated to `/admin` without any stored token — dashboard renders
- Opened Network tab — confirmed all API calls return 401
- Searched `AdminRouter.ts` for any route without middleware — found none
- Checked if there is a wildcard route that bypasses auth — none found

The bug must be in `AdminRouter.ts`. There is likely a route serving
the admin page HTML that does not go through authentication. We need
to add auth to the HTML serving route or add a server-side session check
before rendering the admin shell.
