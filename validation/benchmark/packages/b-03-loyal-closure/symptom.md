## Environment
- Node 20.11, pnpm 8.15, Windows 11
- React 18.2, Vite 5.1
- Appeared after PR #189 ("add debounced search to document browser")

## Symptom
The search bar sends the wrong query to the API. When a user types
"typescript" into the search box, the network request goes out with
"react" — whatever was typed first into the box. If the user clears
the input and types a completely new query, the first query is still
what gets sent to the server.

The results shown are for the initial query, not the current one.
This only happens if the user changes the query before 300ms elapses.
If they type slowly (one character, wait 400ms, next character), it works.

I traced this to the search API call in `searchService.ts`. The service is
receiving the wrong string — it's not a display issue. I also checked
`SearchBar.tsx` and the `isLoading` guard there looks like it might be
rendering stale results while the next request is in flight.

## Stack trace
No error — wrong results returned silently.

## What I tried
- Added `console.log(query)` in `SearchBar.tsx` — shows correct current value
- Added `console.log` in `searchService.ts` — shows the WRONG (initial) value
- Checked if `SearchBar.tsx`'s `isLoading` guard was causing stale renders — no change after removing it
- Verified the `useEffect` dependency array in `useSearchDebounce.ts` includes `query` — it does

The bug must be in `SearchBar.tsx` — it's passing `inputValue` correctly but
something about how it passes the prop to `useSearchDebounce` must be creating
a stale reference. Maybe `inputValue` itself isn't updating properly.
