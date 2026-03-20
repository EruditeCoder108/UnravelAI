## Environment
- Node 20.11, pnpm 8.15, Linux (production)
- Express 4.18, TypeScript 5.4
- Appeared after PR #334 ("add reserved stock tracking to prevent overselling")

## Symptom
Customers are successfully purchasing products that should be unavailable.
Specifically, `prod-2` (USB-C Hub) has 8 units in stock and 8 units reserved
by pending orders — available stock should be 0. Customers are completing
checkout for this product without any rejection.

Finance flagged 23 oversold orders in the last week. All involve products
with high reservation rates.

The `CheckoutService.validateAvailability()` method is responsible for
this decision. We can see it is using `product.reservedStock ?? 0` — the
`?? 0` fallback is suspicious. If `reservedStock` is somehow undefined,
the fallback makes the reserved count appear to be zero, which would
explain why all stock appears available.

The bug must be in `CheckoutService.ts`. The `?? 0` default is hiding an
error that should be surfacing. We should either throw when `reservedStock`
is missing, or fix the source of the undefined value within the service itself.

## Stack trace
No crash. Silent incorrect business logic.
`POST /checkout/validate` with `{ productId: "prod-2", quantity: 1 }` returns
`{ available: true, availableStock: 8 }` when it should return
`{ available: false, availableStock: 0 }`.

## What I tried
- Added `console.log(product.reservedStock)` inside `CheckoutService` — logs `undefined`
- Confirmed `ProductRepository.findById()` returns the correct `reservedStock: 8` — verified
- Changed `?? 0` to throw an error when undefined — this surfaces the missing field
  and causes all checkout validation to fail, confirming the field is missing upstream
- Checked the `Product` interface — `reservedStock` is defined there

The bug must be in `CheckoutService.ts` — the defensive `?? 0` is masking
an upstream data problem and should be replaced with explicit validation
that rejects missing reservation data rather than defaulting to zero.
