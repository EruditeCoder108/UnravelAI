/**
 * B-09: Trusted Input — bug.test.ts
 *
 * Proves that CartRouter passes req.query.total (a string) to
 * DiscountService without parsing it to a number. The `>` comparison
 * with a formatted string like "1,000" coerces to NaN, making the
 * minimum order check always pass — every discount code becomes valid.
 *
 * These tests FAIL on the buggy code.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { validationLog } from '../src/services/DiscountService';

beforeEach(() => { validationLog.length = 0; });

describe('B-09 CartRouter — unparsed query param total', () => {
  it('should REJECT discount when cart total is below minimum (plain number string)', async () => {
    // SAVE20 requires minOrderValue = 50. Cart total = 30 → should be rejected.
    const res = await request(app)
      .get('/cart/apply-discount')
      .query({ code: 'SAVE20', total: '30' });

    expect(res.status).toBe(200);
    // This case PASSES correctly because '30' coerces to 30 — masking the bug
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toContain('Minimum');
  });

  it('should REJECT discount when cart total is below minimum (locale-formatted string)', async () => {
    // Same check but total is formatted as "30.00" with a currency symbol
    // In production, mobile clients sometimes send formatted values.
    const res = await request(app)
      .get('/cart/apply-discount')
      .query({ code: 'VIP100', total: '$30' }); // VIP100 requires 200

    expect(res.status).toBe(200);
    // BUG: '$30' → NaN → 200 > NaN → false → minimum check passes → valid: true
    expect(res.body.valid).toBe(false);
  });

  it('should REJECT discount when total is comma-formatted and below minimum', async () => {
    const res = await request(app)
      .get('/cart/apply-discount')
      .query({ code: 'VIP100', total: '1,000' }); // above minimum — but only if parsed

    // '1,000' → NaN — the check passes vacuously, not because total > 200
    // We verify the validation log to show the runtime type reaching the service
    const logEntry = validationLog[0];
    // BUG: cartTotal in the log is the string '1,000', not the number 1000
    expect(typeof logEntry.cartTotal).toBe('number');
  });

  it('valid discount on a properly formatted total works correctly', async () => {
    const res = await request(app)
      .get('/cart/apply-discount')
      .query({ code: 'SAVE20', total: '100' }); // above minimum of 50

    expect(res.body.valid).toBe(true);
    expect(res.body.discount).toBeCloseTo(20);
    expect(res.body.finalTotal).toBeCloseTo(80);
  });
});
