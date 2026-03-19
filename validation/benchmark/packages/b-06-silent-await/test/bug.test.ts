/**
 * B-06: Silent Await — bug.test.ts
 *
 * Proves that Application.bootstrap() does not await db.init(),
 * and db.init() does not await connect() — so the first query
 * issued after bootstrap() throws DatabaseNotReadyError.
 *
 * These tests FAIL on the buggy code.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Application } from '../src/app/Application';
import { DatabaseNotReadyError } from '../src/services/DatabaseService';

let app: Application;

beforeEach(() => {
  app = new Application();
});

describe('B-06 Application — missing await on db.init()', () => {
  it('should successfully handle a request immediately after bootstrap', async () => {
    await app.bootstrap();

    // Request issued immediately after bootstrap resolves.
    // BUG: bootstrap() returned before the DB was actually ready.
    const response = await app.handleRequest({ userId: 'u1', action: 'fetch' });

    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();
  });

  it('database should be connected after bootstrap resolves', async () => {
    await app.bootstrap();

    // BUG: isConnected() returns false — connect() hasn't resolved yet
    expect(app.getDb().isConnected()).toBe(true);
  });

  it('should not throw DatabaseNotReadyError on the first request', async () => {
    await app.bootstrap();

    const response = await app.handleRequest({ userId: 'u1', action: 'fetch' });

    // BUG: error message contains 'Database is not ready'
    expect(response.error).not.toContain('not ready');
  });

  it('works correctly after an explicit delay (proves timing dependency)', async () => {
    await app.bootstrap();

    // Wait 20ms for the floating connect() promise to resolve
    await new Promise((r) => setTimeout(r, 20));

    // Now it works — confirming the bug is a race, not a logic error
    const response = await app.handleRequest({ userId: 'u1', action: 'fetch' });
    expect(response.success).toBe(true);
  });
});
