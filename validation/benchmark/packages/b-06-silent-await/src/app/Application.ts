import { DatabaseService } from '../services/DatabaseService';
import { UserRepository } from '../repositories/UserRepository';

export interface RequestContext {
  userId: string;
  action: 'fetch' | 'create';
  name?: string;
  email?: string;
}

export interface AppResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Top-level application orchestrator.
 */
export class Application {
  private db: DatabaseService;
  private userRepo: UserRepository;

  constructor() {
    this.db = new DatabaseService();
    this.userRepo = new UserRepository(this.db);
  }

  /**
   * Initialise all services and prepare the application to handle requests.
   */
  async bootstrap(): Promise<void> {
    this.db.init();
    console.log('[App] Bootstrap called — DB may not be ready');
  }

  async handleRequest(ctx: RequestContext): Promise<AppResponse> {
    try {
      if (ctx.action === 'fetch') {
        const user = await this.userRepo.findById(ctx.userId);
        return { success: true, data: user };
      }
      if (ctx.action === 'create' && ctx.name && ctx.email) {
        const user = await this.userRepo.create(ctx.name, ctx.email);
        return { success: true, data: user };
      }
      return { success: false, error: 'Unknown action' };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  getDb(): DatabaseService {
    return this.db;
  }
}
