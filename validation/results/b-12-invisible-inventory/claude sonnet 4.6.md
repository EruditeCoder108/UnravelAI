## Hypothesis Tree

**H1: CheckoutService.ts — `?? 0` fallback silently defaults missing reservedStock to zero**
ELIMINATED. `ProductSerializer.ts:4` — CheckoutService correctly handles `reservedStock` being absent. The `?? 0` is a legitimate guard for an optional field. The service's logic is sound. This hypothesis confuses symptom with cause.

**H2: ProductRepository.ts — findById returns wrong data, dropping reservedStock**
ELIMINATED. `ProductRepository.ts:10–22` — the store hardcodes `prod-2` with `reservedStock: 8` explicitly. Confirmed by developer's own log.

**H3: ProductSerializer.ts:3 — ALLOWED_FIELDS omits reservedStock**
SURVIVED. `ProductSerializer.ts:3` defines `ALLOWED_FIELDS = ['id', 'name', 'price', 'stock']`. The reduce on line 6 only copies listed fields, so `reservedStock` is never written to the output.

---

## Root Cause
`ProductSerializer.ts` line 3 — `reservedStock` absent from `ALLOWED_FIELDS`, so `serialize()` produces an object where that field is `undefined` regardless of what the repository returned.

---

## Causal Chain
```
[ProductRepository.ts:21] findById returns Product with reservedStock: 8
  → [app.ts:24] serializer.serialize(product) called
  → [ProductSerializer.ts:3] ALLOWED_FIELDS has no 'reservedStock' entry
  → [ProductSerializer.ts:5–9] reduce only copies whitelisted fields → reservedStock absent
  → [app.ts:25] serialized object passed to checkout.validateAvailability()
  → [CheckoutService.ts:16] product.reservedStock is undefined → ?? 0 fires → reserved = 0
  → [CheckoutService.ts:17] availableStock = 8 - 0 = 8
  → [CheckoutService.ts:19] 8 >= requestedQty → available: true returned
  → Symptom: fully-reserved product clears checkout
```

---

## Proximate Trap
The report fingers `CheckoutService.ts ?? 0`. Wrong. `?? 0` is a legitimate guard for `reservedStock?: number` — the fallback is both type-correct and intentional. The service behaves exactly as written. The `console.log` showing `undefined` inside `CheckoutService` is evidence of what *enters* the service, not what the service does wrong.

---

## Minimal Fix
Add `'reservedStock'` to `ALLOWED_FIELDS` in `ProductSerializer.ts`:
```ts
const ALLOWED_FIELDS = ['id', 'name', 'price', 'stock', 'reservedStock'];
```
No other file needs to change.