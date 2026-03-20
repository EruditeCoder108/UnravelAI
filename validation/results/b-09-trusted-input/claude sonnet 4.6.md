
Trace through all four files
Trace through all four files
Root cause: CartRouter.ts line 17 — total: total assigns the raw query param string directly to cart.total without parsing it to a number, then as unknown as CartSummary silences the TypeScript error that would have caught it.

The full mechanism. req.query.total is always a string in Express — that's how HTTP query parameters work. In CartRouter.ts, it's destructured from req.query and assigned directly to cart.total without any numeric conversion. The as unknown as CartSummary double-cast on line 20 is the critical enabler: it tells TypeScript "trust me, this is a CartSummary," bypassing the type checker entirely. CartSummary types total as number, but at runtime cart.total is the raw string "$30".

That string then reaches DiscountService.validate(), where this comparison runs:

const belowMinimum = discount.minOrderValue > cart.total;
// 200 > "$30"
JavaScript coerces the string to a number for the comparison. "$30" coerces to NaN. And here's the key property of NaN in JavaScript: every comparison involving NaN returns false. 200 > NaN is false. 200 >= NaN is false. 200 < NaN is false. All of them. So belowMinimum is false, the minimum order check is silently bypassed, and the discount is granted.

This explains your observation pattern exactly:

total value	Coerces to	200 > x	Outcome
"30" (plain number string)	30	true	Correctly rejected
"$30" (currency symbol)	NaN	false	Incorrectly accepted
"1,000" (thousand separator)	NaN	false	Incorrectly accepted
"1000" (plain number string)	1000	false	Correctly accepted
Desktop clients passing plain "150" strings work fine because Number("150") = 150 is a valid number and comparisons work normally. Mobile clients formatting as "$150" or "1,500.00" hit NaN on every comparison.

Why your debugging led you astray. You logged console.log(discount.minOrderValue, cart.total) and saw 200 "$30". You then assumed the comparison would "still work" — but the crucial insight is that 200 > "$30" does not throw a TypeError in JavaScript, it silently coerces and returns false via NaN. This is TYPE_COERCION — the bug category where JavaScript's implicit conversion rules produce logically incorrect results without any runtime error. Changing > to >= had no effect for exactly the same reason: 200 >= NaN is also false.

Why the fix doesn't belong in DiscountService. validate() accepts a CartSummary whose contract says total is a number. The method is operating on a value that violates its own type contract. Adding Number(cart.total) inside validate() would fix the symptom but make the service silently responsible for sanitising bad data from every possible caller — the wrong layer of responsibility. The corruption enters the system at the HTTP boundary. That's where it should be caught and rejected.

The fix — CartRouter.ts:

diff
--- CartRouter.ts
  if (!code || !total) {
    return res.status(400).json({ error: 'code and total are required' });
  }

+ const parsedTotal = parseFloat(total as string);
+ if (isNaN(parsedTotal) || parsedTotal < 0) {
+   return res.status(400).json({ error: 'total must be a valid positive number' });
+ }

  const cart = {
-   total: total,
+   total: parsedTotal,
    currency: currency as string,
    itemCount: parseInt(items as string, 10) || 1,
- } as unknown as CartSummary;
+ } satisfies CartSummary;
Two changes. First, parseFloat(total as string) and an explicit isNaN guard: any non-numeric string — "$30", "1,000", "thirty" — now returns a 400 with a clear error message instead of silently bypassing business logic. Second, as unknown as CartSummary replaced with satisfies CartSummary: TypeScript will now verify that the object literal actually conforms to the type, and will report an error at compile time if total isn't a number. The as unknown as pattern is almost always a sign that something unsafe is happening at that exact line.

One note on the stack trace in your report. You showed GET /cart/apply-discount?code=VIP100&total=%2430 returning { valid: true, discount: 4.5 }. %24 URL-decodes to $, so total = "$30". But "$30" * 15 / 100 = NaN, not 4.5. The 4.5 would come from a plain "30" string. The mechanism is the same either way — any non-numeric character in the string produces NaN and bypasses the minimum order check — but the specific example in the trace may have been from a different test run.