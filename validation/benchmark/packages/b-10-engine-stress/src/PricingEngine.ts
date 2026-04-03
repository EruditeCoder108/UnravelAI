// PricingEngine.ts
// Handles discount lookups and order total calculation.
// Called by OrderRouter on every checkout request.

import { DISCOUNT_REGISTRY } from './DiscountRegistry';

// ── Module-level shared state (the trap) ──────────────────────────────────────
let activeRequestCount = 0;
let lastFetchedDiscount: number = 0;     // ← shared across concurrent calls
let cachedPricingRules: Record<string, number> | null = null;

export async function fetchDiscountForCode(code: string): Promise<number> {
    activeRequestCount++;

    // Simulate async DB/network lookup
    const discount = await DISCOUNT_REGISTRY.lookup(code);

    // BUG 1 (RACE CONDITION): lastFetchedDiscount is written AFTER the await.
    // If two concurrent callers both call fetchDiscountForCode(), Caller A writes
    // lastFetchedDiscount = 0.10, then Caller B overwrites it with 0.20 before
    // Caller A's calculateTotal reads it. Caller A applies Caller B's discount.
    lastFetchedDiscount = discount;

    activeRequestCount--;
    return discount;
}

export async function calculateTotal(
    items: { price: number; qty: number }[],
    discountCode: string
): Promise<number> {
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);

    // Fetch the discount — this is async, so other requests can interleave
    await fetchDiscountForCode(discountCode);

    // BUG 1 continued: reads lastFetchedDiscount, which may have been overwritten
    // by a concurrent request between the await above and this line.
    const discountedTotal = subtotal * (1 - lastFetchedDiscount);

    // BUG 2 (FLOATING PROMISE): pricing rules refresh not awaited.
    // If this throws, error is silently dropped.
    refreshPricingRules(discountCode);

    return discountedTotal;
}

async function refreshPricingRules(code: string) {
    cachedPricingRules = await DISCOUNT_REGISTRY.getRules(code);
}
