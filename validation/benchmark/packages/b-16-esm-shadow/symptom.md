## Environment
- Node 20.11, pnpm 8.15, macOS 14.3
- TypeScript 5.4, package.json "type": "module"
- Appeared after PR #445 ("migrate to ESM")

## Symptom
All static asset requests return 404 after the ESM migration. HTML pages
load correctly, API endpoints respond correctly, but every request for
an image, CSS file, or uploaded file returns 404.

The Express static middleware appears to be configured correctly in
`app.ts`. The asset paths look right in code review. The only clue is
a console log showing the static root path contains the string `undefined`.

I believe the bug is in `app.ts` — the ESM migration updated most of the
`__dirname` references, but the static middleware configuration might
still be using the old pattern somewhere.

## Stack trace
No crash. Every GET /assets/* returns 404.
Console log: `Static root: undefined/public/images`

## What I tried
- Re-checked `app.ts` ESM migration — `__dirname` is correctly replaced there
- Added `console.log` to `getStaticRoot()` — logs `undefined/public/images`
- Searched for `__dirname` in `app.ts` — the local declaration looks right
- Tried hardcoding the path directly in `app.ts` — fixes the symptom,
  confirming the issue is in path construction, not middleware config

The bug must be in the static middleware registration in `app.ts`. The
`buildAssetPath()` call must be receiving or returning a wrong base path.
We should replace the `buildAssetPath()` call with a direct `join(__dirname, ...)`
call in `app.ts` as a workaround.
