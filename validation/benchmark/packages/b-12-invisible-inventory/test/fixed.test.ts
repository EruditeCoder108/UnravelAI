/**
 * Fix: src/serializers/ProductSerializer.ts
 *
 * BEFORE:
 *   const ALLOWED_FIELDS = ['id', 'name', 'price', 'stock'];
 *
 * AFTER:
 *   const ALLOWED_FIELDS = ['id', 'name', 'price', 'stock', 'reservedStock'];
 */

import { describe, it, expect } from 'vitest';
import { Product, SerializedProduct } from '../src/models/Product';
import { CheckoutService } from '../src/services/CheckoutService';

const ALLOWED_FIELDS_FIXED = ['id', 'name', 'price', 'stock', 'reservedStock'];

function serializeFixed(product: Product): SerializedProduct {
  return ALLOWED_FIELDS_FIXED.reduce((acc, field) => {
    (acc as Record<string, unknown>)[field] = (product as Record<string, unknown>)[field];
    return acc;
  }, {} as SerializedProduct);
}

const SAMPLE_PRODUCT: Product = {
  id: 'prod-2',
  name: 'USB-C Hub',
  price: 39.99,
  stock: 8,
  reservedStock: 8,
  sku: 'HUB-004',
  category: 'peripherals',
};

describe('B-12 ProductSerializer — fixed', () => {
  it('serialized product includes reservedStock', () => {
    const serialized = serializeFixed(SAMPLE_PRODUCT);
    expect(serialized.reservedStock).toBe(8);
  });

  it('checkout correctly identifies zero availability when all stock is reserved', () => {
    const checkout = new CheckoutService();
    const serialized = serializeFixed(SAMPLE_PRODUCT);
    const result = checkout.validateAvailability(serialized, 1);
    expect(result.availableStock).toBe(0);
    expect(result.available).toBe(false);
  });

  it('checkout correctly allows purchase when unreserved stock exists', () => {
    const checkout = new CheckoutService();
    const product: Product = { ...SAMPLE_PRODUCT, stock: 20, reservedStock: 5 };
    const serialized = serializeFixed(product);
    const result = checkout.validateAvailability(serialized, 10);
    expect(result.availableStock).toBe(15);
    expect(result.available).toBe(true);
  });
});
