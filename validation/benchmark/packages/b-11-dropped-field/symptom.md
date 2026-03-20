## Environment
- Node 20.11, pnpm 8.15, macOS 14.3
- TypeScript 5.4
- Appeared after PR #217 ("add avatar support to user profiles")

## Symptom
User avatars are not displaying anywhere in the application. The `<img>`
tags render with a broken image icon. `user.avatarUrl` is `undefined`
throughout the frontend.

The external API is definitely returning avatar URLs — we confirmed this
by logging the raw API response. The field is `avatar_url` in the API
response and our TypeScript interface has `avatarUrl` after camelCase
mapping.

The issue seems to be in our display components. The `UserCard` component
receives the user object and accesses `user.avatarUrl` — perhaps the
prop type is wrong or there is a mismatch between what the component
expects and what it receives.

## Stack trace
No crash. Silent undefined field.
`console.log(user.avatarUrl)` → `undefined` in every component that reads it.

## What I tried
- Confirmed the external API returns `avatar_url` — checked network tab
- Added a fallback image URL in the display component — this works as a
  workaround but does not fix the root cause
- Checked the `UserProfile` TypeScript interface — `avatarUrl` is defined
- Verified prop types in `UserCard` component — they look correct

The bug must be in the display layer. The component is receiving a user
object where `avatarUrl` is undefined, so either the prop drilling is
dropping it or the component's internal state handling is resetting it.
