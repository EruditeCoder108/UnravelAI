import { SerializedProduct } from '../models/Product';

export interface AvailabilityResult {
  available: boolean;
  availableStock: number;
  requestedQty: number;
  reason?: string;
}

export class CheckoutService {
  validateAvailability(
    product: SerializedProduct,
    requestedQty: number
  ): AvailabilityResult {
    const reserved = product.reservedStock ?? 0;
    const availableStock = product.stock - reserved;

    if (availableStock < requestedQty) {
      return {
        available: false,
        availableStock,
        requestedQty,
        reason: `Only ${availableStock} units available (${product.stock} total, ${reserved} reserved)`,
      };
    }

    return { available: true, availableStock, requestedQty };
  }
}
