## Root Cause
**File:** `src/serializers/ProductSerializer.ts` **Line:** 9
`ALLOWED_FIELDS` is a string array used to whitelist which product fields
are included in the API response. When `reservedStock` was added to the
`Product` model, it was added to the TypeScript interface and populated by
`ProductRepository`, but was never added to `ALLOWED_FIELDS`. The serializer
iterates over `ALLOWED_FIELDS` to build the response object — any field not
in the list is silently absent from the output.

## Causal Chain
1. `ProductRepository.findById()` fetches from the store — returns full
   `Product` including `reservedStock: 12`
2. `ProductSerializer.serialize()` builds response by iterating `ALLOWED_FIELDS`
3. `ALLOWED_FIELDS = ['id', 'name', 'price', 'stock']` — no `reservedStock`
4. Response object built: `{ id, name, price, stock }` — `reservedStock` absent
5. `CheckoutService.validateAvailability()` reads `product.reservedStock`
6. Field is `undefined` — treated as `0` in arithmetic
7. `availableStock = product.stock - 0` — no stock is reserved, oversell allowed
Hops: 4 files (CheckoutService ← ProductSerializer bug ← ProductRepository ← Product model)

## Key AST Signals
- `ALLOWED_FIELDS` is a literal array at `ProductSerializer.ts L9` —
  fixed at declaration, never modified
- `ProductRepository.findById()` return value contains `reservedStock` —
  field written in the repository layer
- Call graph: `ProductSerializer.serialize()` → builds object via
  `ALLOWED_FIELDS.reduce()` — no read of `.reservedStock` anywhere in body
- `CheckoutService.ts` reads `product.reservedStock` — cross-file trace
  shows field absent from the object arriving there

## The Fix
```diff
- const ALLOWED_FIELDS = ['id', 'name', 'price', 'stock'];
+ const ALLOWED_FIELDS = ['id', 'name', 'price', 'stock', 'reservedStock'];
```

## Why the Fix Works
Adding `reservedStock` to `ALLOWED_FIELDS` causes the serializer's reduce
loop to include it in the output. `CheckoutService` then receives the
correct reserved count and subtracts it from available stock correctly.

## Proximate Fixation Trap
The reporter blames `CheckoutService.validateAvailability()` because that
is where the oversell decision is made. The arithmetic there looks wrong —
`availableStock = product.stock - product.reservedStock` evaluates to
`product.stock - undefined` which is `NaN`, but the `>= requested` check
treats `NaN >= N` as false... wait, actually it's the opposite: the service
uses `product.reservedStock ?? 0` defensively, making the bug invisible
in the service. The field is just missing. Debugging the service in isolation
never reveals that `reservedStock` is `undefined` because the API response
doesn't include it.

## Benchmark Metadata
- Category: `DATA_FLOW`
- Difficulty: Hard
- Files: 5
- File hops from symptom to root cause: 4 (CheckoutService → API response → Serializer bug)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
