// OrderRouter.ts
// Express router — entry point for all checkout requests.
// BUG 5 (CROSS-FILE MUTATION): directly mutates DISCOUNT_REGISTRY._store,
//         bypassing the exported registerCode() API. This breaks encapsulation.
// BUG 6 (TYPE CONFUSION): req.query.qty is a string. It's used in a numeric
//         multiplication without parseInt — produces NaN or string concatenation.

import { Router, Request, Response } from 'express';
import { calculateTotal } from './PricingEngine';
import { DISCOUNT_REGISTRY } from './DiscountRegistry';
import { startSession, logout, getSession } from './SessionManager';

const router = Router();

// Admin endpoint: seed discount codes
router.post('/admin/discount', (req: Request, res: Response) => {
    const { code, rate, maxUses } = req.body;

    // BUG 5 (CROSS-FILE MUTATION): writes directly to _store instead of
    // calling DISCOUNT_REGISTRY.registerCode(). If the internal structure of
    // _store ever changes, this silently breaks. Also bypasses any validation
    // logic that registerCode() might add in the future.
    DISCOUNT_REGISTRY._store[code] = {
        rate: parseFloat(rate),
        usageCount: 0,
        maxUses: parseInt(maxUses),
    };

    res.json({ ok: true });
});

// Checkout endpoint
router.post('/checkout', async (req: Request, res: Response) => {
    const session = getSession();
    if (!session) return res.status(401).json({ error: 'No session' });

    const { items, discountCode } = req.body;

    // BUG 6 (TYPE CONFUSION): req.query.qty (or body qty) comes in as string.
    // The mapping below multiplies price * qty — but if qty is "2", the result
    // is string concatenation on some JS engines or NaN via implicit coercion.
    const parsedItems = items.map((item: { price: string; qty: string }) => ({
        price: parseFloat(item.price),
        qty: item.qty,               // ← stays as string! never parsed
    }));

    try {
        // calculateTotal expects { price: number; qty: number }[]
        // but receives { price: number; qty: string }[] — type confusion at runtime
        const total = await calculateTotal(parsedItems as any, discountCode);
        res.json({ total, sessionId: session.userId });
    } catch (err) {
        res.status(500).json({ error: 'Checkout failed' });
    }
});

// Login endpoint
router.post('/login', (req: Request, res: Response) => {
    const { userId, cartTotal } = req.body;
    const session = startSession(userId, parseFloat(cartTotal));
    res.json({ sessionId: session.userId });
});

// Logout endpoint
router.post('/logout', (_req: Request, res: Response) => {
    logout();
    res.json({ ok: true });
});

export default router;
