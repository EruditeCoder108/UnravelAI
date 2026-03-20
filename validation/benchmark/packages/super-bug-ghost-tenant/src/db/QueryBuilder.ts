import { getTenant } from '../context/TenantContext';

export type OrderDirection = 'ASC' | 'DESC';

export interface QueryOptions {
  orderBy?: string;
  orderDir?: OrderDirection;
  limit?: number;
  offset?: number;
  filters?: Record<string, unknown>;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
  tenantId: string;
}

export class QueryBuilder {
  private tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  buildSelect(opts: QueryOptions = {}): BuiltQuery {
    const tenantId = getTenant();
    const params: unknown[] = [tenantId];
    const conditions: string[] = ['tenant_id = $1'];
    let paramIndex = 2;

    if (opts.filters) {
      for (const [col, val] of Object.entries(opts.filters)) {
        conditions.push(`${col} = $${paramIndex}`);
        params.push(val);
        paramIndex++;
      }
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const orderClause = opts.orderBy
      ? `ORDER BY ${opts.orderBy} ${opts.orderDir ?? 'ASC'}`
      : 'ORDER BY created_at DESC';
    const limitClause = opts.limit ? `LIMIT ${opts.limit}` : '';
    const offsetClause = opts.offset ? `OFFSET ${opts.offset}` : '';

    const parts = [
      `SELECT * FROM ${this.tableName}`,
      where,
      orderClause,
      limitClause,
      offsetClause,
    ].filter(Boolean);

    return { sql: parts.join(' ').trim(), params, tenantId };
  }

  buildInsert(data: Record<string, unknown>): BuiltQuery {
    const tenantId = getTenant();
    const withTenant = { ...data, tenant_id: tenantId };
    const columns = Object.keys(withTenant).join(', ');
    const placeholders = Object.keys(withTenant)
      .map((_, i) => `$${i + 1}`)
      .join(', ');
    const params = Object.values(withTenant);

    return {
      sql: `INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders}) RETURNING *`,
      params,
      tenantId,
    };
  }

  buildUpdate(id: string, data: Record<string, unknown>): BuiltQuery {
    const tenantId = getTenant();
    const setClause = Object.keys(data)
      .map((col, i) => `${col} = $${i + 1}`)
      .join(', ');
    const params = [...Object.values(data), id, tenantId];

    return {
      sql: `UPDATE ${this.tableName} SET ${setClause} WHERE id = $${Object.keys(data).length + 1} AND tenant_id = $${Object.keys(data).length + 2}`,
      params,
      tenantId,
    };
  }

  buildDelete(id: string): BuiltQuery {
    const tenantId = getTenant();
    return {
      sql: `DELETE FROM ${this.tableName} WHERE id = $1 AND tenant_id = $2`,
      params: [id, tenantId],
      tenantId,
    };
  }
}
