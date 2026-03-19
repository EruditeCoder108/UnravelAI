/**
 * B-09: Trusted Input — fixed.test.ts
 *
 * Fix applied to src/routes/CartRouter.ts:
 *
 * BEFORE (buggy):
 *   const cart = { total: total, ... } as unknown as CartSummary;
 *
 * AFTER (fixed):
 *   const rawTotal = total as string;
 *   const parsedTotal = parseFloat(rawTotal.replace(/[^0-9.]/g, ''));
 *   if (isNaN(parsedTotal)) return res.status(400).json({ error: 'Invalid total' });
 *   const cart: CartSummary = { total: parsedTotal, ... };
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { DiscountService, validationLog } from '../src/services/DiscountService';
import { CartSummary } from '../src/models/CartSummary';

// Fixed router
const fixedApp = express();
fixedApp.use(express.json());
const discountService = new DiscountService();

fixedApp.get('/cart/apply-discount', (req: Request, res: Response) => {
  const { code, total, currency = 'USD', items = '1' } = req.query;
  if (!code || !total) return res.status(400).json({ error: 'code and total are required' });

  // FIX: strip non-numeric characters and parse to float
  const rawTotal = total as string;
  const parsedTotal = parseFloat(rawTotal.replace(/[^0-9.]/g, ''));
  if (isNaN(parsedTotal)) return res.status(400).json({ error: 'Invalid total' });

  const cart: CartSummary = {
    total: parsedTotal,
    currency: currency as string,
    itemCount: parseInt(items as string, 10) || 1,
  };

  return res.json(discountService.validate(code as string, cart));
});

beforeEach(() => { validationLog.length = 0; });

describe('B-09 CartRouter — parsed total (fixed)', () => {
  it('rejects discount when formatted total is below minimum', async () => {
    const res = await request(fixedApp)
      .get('/cart/apply-discount')
      .query({ code: 'VIP100', total: '$30' });

    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toContain('Minimum');
  });

  it('correctly validates comma-formatted total above minimum', async () => {
    const res = await request(fixedApp)
      .get('/cart/apply-discount')
      .query({ code: 'VIP100', total: '1,000' });

    expect(res.body.valid).toBe(true);
    expect(typeof validationLog[0].cartTotal).toBe('number');
    expect(validationLog[0].cartTotal).toBe(1000);
  });

  it('returns 400 for unparseable total', async () => {
    const res = await request(fixedApp)
      .get('/cart/apply-discount')
      .query({ code: 'SAVE20', total: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid');
  });

  it('applies correct discount on valid numeric string', async () => {
    const res = await request(fixedApp)
      .get('/cart/apply-discount')
      .query({ code: 'SAVE20', total: '100' });

    expect(res.body.valid).toBe(true);
    expect(res.body.finalTotal).toBeCloseTo(80);
  });
});
