export interface CartSummary {
  total: number;   // ← typed as number; actual runtime value from query param is string
  currency: string;
  itemCount: number;
}

export interface DiscountRecord {
  code: string;
  percentage: number;   // e.g. 20 = 20% off
  minOrderValue: number;
  expiresAt: number;    // unix timestamp
  active: boolean;
}

export interface DiscountResult {
  valid: boolean;
  discount?: number;     // absolute amount saved
  finalTotal?: number;
  reason?: string;
}
