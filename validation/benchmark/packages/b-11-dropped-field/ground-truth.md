## Root Cause
**File:** `src/mappers/ProfileMapper.ts` **Lines:** 31-35
The second mapping stage uses explicit destructuring to build its return
value: `const { id, name, email } = input; return { id, name, email }`.
When `avatarUrl` was added to the `UserProfile` interface and populated by
the first mapper, nobody updated this destructuring. The field is present
in the object entering `ProfileMapper.toInternal()` and silently absent
from the object leaving it.

## Causal Chain
1. `ProfileService.fetchById()` calls `ApiClient.getUser()` — returns raw API
   response including `avatarUrl`
2. `ExternalMapper.toProfile()` maps the raw response to `UserProfile` —
   `avatarUrl` correctly included
3. `ProfileMapper.toInternal()` receives the populated `UserProfile` object
4. Explicit destructuring `const { id, name, email } = profile` discards `avatarUrl`
5. Return value `{ id, name, email }` — field dropped, no error, no warning
6. `ProfileRepository.save()` stores the incomplete record
7. Consumer reads `user.avatarUrl` — value is `undefined`
Hops: 4 files (ProfileService → ExternalMapper → ProfileMapper bug → ProfileRepository)

## Key AST Signals
- Mutation chain: `avatarUrl` written in `ExternalMapper.toProfile()` at the
  return statement — present in output type
- `ProfileMapper.toInternal()` return value: destructuring does not include
  `avatarUrl` — field is never read from `profile` inside this function
- Cross-file: `UserProfile.avatarUrl` is defined in the shared type and
  populated upstream, but the call graph path through `ProfileMapper` has
  no read of `.avatarUrl` anywhere in its body
- No TypeScript error because the return type annotation was also not updated
  when the field was added — the interface was updated but the mapper return
  type uses inference, so TS sees a narrower valid subtype

## The Fix
```diff
  toInternal(profile: UserProfile): InternalUser {
-   const { id, name, email } = profile;
-   return { id, name, email };
+   const { id, name, email, avatarUrl } = profile;
+   return { id, name, email, avatarUrl };
  }
```

## Why the Fix Works
Including `avatarUrl` in the destructuring and the return object passes
the field through the mapping stage without loss. All downstream consumers
receive the correct value.

## Proximate Fixation Trap
The reporter blames the display component because that is where
`avatarUrl` renders as undefined — the `<img src={user.avatarUrl}` tag
shows a broken image. The component is reading the field correctly.
The field simply is not present in the data passed to it. A developer
adding a null-check or fallback image in the component treats the symptom.

## Benchmark Metadata
- Category: `DATA_FLOW`
- Difficulty: Medium
- Files: 4
- File hops from symptom to root cause: 3 (Service → ExternalMapper → ProfileMapper)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
