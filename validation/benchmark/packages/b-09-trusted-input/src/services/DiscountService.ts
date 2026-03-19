import { CartSummary, DiscountRecord, DiscountResult } from '../models/CartSummary';

// In-memory discount store (replaces DB for test purposes)
const DISCOUNTS: Record<string, DiscountRecord> = {
  SAVE20: {
    code: 'SAVE20',
    percentage: 20,
    minOrderValue: 50,
    expiresAt: Date.now() + 86_400_000,
    active: true,
  },
  VIP100: {
    code: 'VIP100',
    percentage: 15,
    minOrderValue: 200,
    expiresAt: Date.now() + 86_400_000,
    active: true,
  },
};

export const validationLog: Array<{
  code: string;
  cartTotal: unknown;
  minOrderValue: number;
  passed: boolean;
}> = [];

/**
 * Validates a discount code against the current cart.
 *
 * This service looks like the bug location because it returns `valid: true`
 * for carts that clearly don't meet the minimum order requirement.
 * A developer adding logging here will see the unexpected `true` result
 * and conclude the comparison logic is wrong.
 *
 * In reality the comparison `discount.minOrderValue > cart.total` is
 * correct TypeScript — the BUG is that `cart.total` is a string at
 * runtime despite the type annotation saying `number`. The string comes
 * in from the HTTP query parameter unmodified.
 */
export class DiscountService {
  validate(code: string, cart: CartSummary): DiscountResult {
    const discount = DISCOUNTS[code.toUpperCase()];

    if (!discount) {
      return { valid: false, reason: 'Code not found' };
    }
    if (!discount.active) {
      return { valid: false, reason: 'Code inactive' };
    }
    if (Date.now() > discount.expiresAt) {
      return { valid: false, reason: 'Code expired' };
    }

    // BUG SURFACE: This comparison looks correct in TypeScript.
    // `discount.minOrderValue` is genuinely a number (50).
    // `cart.total` is typed as `number` but is actually a string at runtime.
    // When cart.total is "1,000" → coerces to NaN → 50 > NaN → false → check passes.
    // When cart.total is "30" → coerces to 30 → 50 > 30 → true → correctly rejected.
    // The bug only manifests for non-standard numeric strings.
    const belowMinimum = discount.minOrderValue > cart.total;

    validationLog.push({
      code,
      cartTotal: cart.total,
      minOrderValue: discount.minOrderValue,
      passed: !belowMinimum,
    });

    if (belowMinimum) {
      return {
        valid: false,
        reason: `Minimum order value is ${discount.minOrderValue}`,
      };
    }

    const discountAmount = (cart.total * discount.percentage) / 100;
    return {
      valid: true,
      discount: discountAmount,
      finalTotal: cart.total - discountAmount,
    };
  }
}
