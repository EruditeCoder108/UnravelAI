## Environment
- Node 20.11, pnpm 8.15, Linux (production)
- Express 4.18, TypeScript 5.4
- Reproduced in production since PR #502 ("support international cart totals")

## Symptom
Discount codes are being accepted for orders that don't meet the minimum
order value. A user with a cart total of $30 can apply the VIP100 code
(which requires $200 minimum) and receives a 15% discount. This is causing
revenue loss and the finance team has flagged it.

The bug only affects certain users — specifically those using mobile clients
that format the cart total with currency symbols or thousand separators
(e.g. "$30", "1,000"). Desktop clients that pass plain numeric strings are
not affected.

I've traced the issue to `DiscountService.ts`. The `validate()` method's
minimum order check is returning `false` when it should return `true` — I
can see this in the validation log. The comparison `discount.minOrderValue > cart.total`
must be evaluating incorrectly. Either the discount records have wrong
`minOrderValue` values, or the comparison operator is wrong and should be `>=`.

## Stack trace
No crash — silent incorrect business logic.
`GET /cart/apply-discount?code=VIP100&total=%2430` → `{ valid: true, discount: 4.5 }`
(total is URL-encoded "$30", should be rejected)

## What I tried
- Verified discount records in the store: `VIP100.minOrderValue = 200` — correct
- Changed `>` to `>=` in `DiscountService.validate()` — no change in behaviour
- Added `console.log(discount.minOrderValue, cart.total)` — logs `200 "$30"`,
  which shows the values but the developer assumed the comparison would still work
- Checked if `cart.total` was being rounded or truncated somewhere upstream — no
  evidence of that in `CartRouter.ts`

The bug must be in `DiscountService.ts` — the comparison logic is not handling
edge cases correctly. We may need to add explicit type validation or rounding
before the comparison.
