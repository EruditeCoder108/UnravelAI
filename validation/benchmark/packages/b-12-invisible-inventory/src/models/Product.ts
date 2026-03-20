export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  reservedStock: number;
  sku: string;
  category: string;
}

export interface SerializedProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  reservedStock?: number;
}
