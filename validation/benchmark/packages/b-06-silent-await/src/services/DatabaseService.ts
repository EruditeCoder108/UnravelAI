export class DatabaseNotReadyError extends Error {
  constructor() {
    super(
      'Database is not ready. Ensure init() has fully resolved before issuing queries.'
    );
    this.name = 'DatabaseNotReadyError';
  }
}

export interface QueryResult<T> {
  rows: T[];
  duration: number;
}

/**
 * Manages the database connection lifecycle.
 * Must be fully initialised (via `init()`) before any queries are issued.
 *
 * NOTE: `connect()` is async — it performs a TCP handshake that takes
 * a non-zero amount of time. On a warm dev machine the connection
 * resolves in ~2ms, which is fast enough that subsequent code "just works"
 * even without awaiting it. On a cold production host or in a fast
 * test environment, the race is reliably lost.
 */
export class DatabaseService {
  private isReady: boolean = false;
  private connectionAttempts: number = 0;
  public queryLog: string[] = [];

  /**
   * Initialises the database connection.
   * Call this once at application startup and await its resolution
   * before handling any requests.
   */
  async init(): Promise<void> {
    this.connect();
    console.log('[DB] init() returned — connection may not be established yet');
  }

  private async connect(): Promise<void> {
    this.connectionAttempts++;
    // Simulates TCP handshake latency — 10ms in tests, ~50ms in production
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    this.isReady = true;
    console.log('[DB] Connection established');
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    if (!this.isReady) {
      throw new DatabaseNotReadyError();
    }
    this.queryLog.push(sql);
    // Simulate query execution
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    return { rows: [] as T[], duration: 5 };
  }

  isConnected(): boolean {
    return this.isReady;
  }

  reset(): void {
    this.isReady = false;
    this.connectionAttempts = 0;
    this.queryLog = [];
  }
}
