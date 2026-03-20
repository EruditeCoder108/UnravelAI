import { Product, SerializedProduct } from '../models/Product';

const ALLOWED_FIELDS = ['id', 'name', 'price', 'stock'];

export class ProductSerializer {
  serialize(product: Product): SerializedProduct {
    return ALLOWED_FIELDS.reduce((acc, field) => {
      (acc as Record<string, unknown>)[field] = (product as Record<string, unknown>)[field];
      return acc;
    }, {} as SerializedProduct);
  }

  serializeMany(products: Product[]): SerializedProduct[] {
    return products.map((p) => this.serialize(p));
  }
}
