## Root Cause
**File:** `src/services/DiscountService.ts` **Line:** 52  
`discount.minOrderValue > cart.total` compares a `number` (from the discount
record) against a `string` (from the HTTP query parameter, never parsed to a
number). JavaScript's `>` operator with mixed types coerces the string to a
number — but only when the string is a pure numeric literal. When `cart.total`
is `"99.99"`, JS coerces it to `99.99` and the comparison works by accident.
When it is `"100"` (no decimal), coercion works too. The bug only surfaces for
edge cases like totals passed with currency symbols (`"$100"`) or locale
formatting (`"1,000"`) which coerce to `NaN`, making every comparison false
and every discount code valid regardless of minimum order.

## Causal Chain
1. Client sends `GET /apply-discount?code=SAVE20&total=1%2C000` (URL-encoded comma)
2. `CartRouter` reads `req.query.total` → string `"1,000"` — never parsed
3. `CartRouter.applyDiscount()` passes the raw string to `DiscountService.validate()`
4. `DiscountService.validate()` receives `cart: { total: "1,000" }` (string)
5. `discount.minOrderValue > cart.total` → `50 > "1,000"` → `50 > NaN` → `false`
6. Minimum order check passes — `"1,000"` is treated as meeting ANY minimum
7. Discount is applied regardless of actual cart value
8. `OrderSummary.tsx` displays incorrect discounted total
Hops: 4 files (CartRouter → DiscountService bug → OrderRepository → OrderSummary observes)

## Key AST Signals
- Type coercion: `DiscountService.ts L52` — `>` operator with `discount.minOrderValue`
  (typed `number`) and `cart.total` typed as `number` in the interface but supplied
  as a string at runtime — TypeScript interface lies about the runtime type
- `CartRouter.ts`: `req.query.total` is `string | string[] | ParsedQs` — assigned
  to `cart.total` typed as `number` via a cast (`as CartSummary`) without parsing
- No `parseFloat()`, `Number()`, or `+` coercion on `req.query.total` anywhere
  in the call path between CartRouter and DiscountService
- Mutation chain: `cart.total` flows from query param → CartRouter → DiscountService
  without transformation

## The Fix
```diff
  // CartRouter.ts
- const cart: CartSummary = { total: req.query.total as unknown as number };
+ const rawTotal = req.query.total;
+ const total = typeof rawTotal === 'string' ? parseFloat(rawTotal.replace(/[^0-9.]/g, '')) : NaN;
+ if (isNaN(total)) return res.status(400).json({ error: 'Invalid total' });
+ const cart: CartSummary = { total };
```

## Why the Fix Works
`parseFloat` with the non-numeric character strip produces a proper `number`
primitive before the value enters the service layer. `DiscountService` then
performs a clean `number > number` comparison with no coercion edge cases.
Invalid totals (empty string, pure symbols) produce `NaN` which is caught
before reaching the discount logic.

## Proximate Fixation Trap
The reporter blames `DiscountService.ts` directly — specifically the
`validate()` method's return value — because that is where the wrong
`true` result originates. Adding logging there shows the method returning
`true` for coupons that should be rejected. The actual entry point of the
corrupt data is `CartRouter.ts`, where `req.query.total` (a string) is cast
to `CartSummary` without parsing. The service receives a string masquerading
as a number and TypeScript raises no alarm because the cast suppresses it.

## Benchmark Metadata
- Category: `TYPE_COERCION`
- Difficulty: Hard
- Files: 5
- File hops from symptom to root cause: 3 (DiscountService ← CartRouter, type enters there)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
