import { DatabaseService } from '../services/DatabaseService';

export interface User {
  id: string;
  name: string;
  email: string;
}

/**
 * Data access layer for user records.
 *
 * The `findById` method calls `db.query()` which internally checks
 * `isReady`. When the app hasn't finished initialising, this throws
 * `DatabaseNotReadyError` — and the stack trace points directly here.
 *
 * A developer debugging the crash will look at this method first.
 * The `isReady` check inside DatabaseService looks like an overly
 * strict guard that could be relaxed or retried. It is not the problem.
 * The problem is that `db.init()` was never properly awaited, so
 * `isReady` is correctly false at the time of this call.
 */
export class UserRepository {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async findById(id: string): Promise<User | null> {
    // DatabaseNotReadyError thrown from db.query() if init() hasn't resolved
    const result = await this.db.query<User>(
      'SELECT id, name, email FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  }

  async findAll(): Promise<User[]> {
    const result = await this.db.query<User>('SELECT id, name, email FROM users');
    return result.rows;
  }

  async create(name: string, email: string): Promise<User> {
    const id = `user_${Date.now()}`;
    await this.db.query(
      'INSERT INTO users (id, name, email) VALUES ($1, $2, $3)',
      [id, name, email]
    );
    return { id, name, email };
  }
}
