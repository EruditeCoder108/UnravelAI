// DiscountRegistry.ts
// Exported singleton that manages discount codes.
// Imported by PricingEngine and mutated by OrderRouter.

export type DiscountEntry = {
    rate: number;
    usageCount: number;
    maxUses: number;
};

// ── Exported mutable state (cross-file mutation target) ──────────────────────
export const DISCOUNT_REGISTRY = {
    _store: {} as Record<string, DiscountEntry>,

    async lookup(code: string): Promise<number> {
        // Simulate network latency
        await new Promise(r => setTimeout(r, Math.random() * 50));
        const entry = this._store[code];
        if (!entry) return 0;
        return entry.rate;
    },

    async getRules(code: string): Promise<Record<string, number>> {
        await new Promise(r => setTimeout(r, 10));
        return { [code]: this._store[code]?.rate ?? 0 };
    },

    // Exported mutation function — can be called from any importer
    registerCode(code: string, entry: DiscountEntry) {
        this._store[code] = entry;
    },
};
