import { AuthService } from '../auth/AuthService';

export interface UserRecord {
  id: string;
  name: string;
  roles: string[];
}

const USER_STORE: Record<string, UserRecord> = {
  'user001': { id: 'user001', name: 'Alice', roles: ['viewer'] },
  'user002': { id: 'user002', name: 'Bob', roles: ['editor', 'viewer'] },
  'admin01': { id: 'admin01', name: 'Carol', roles: ['admin', 'editor', 'viewer'] },
};

export class UserService {
  private authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  getRoles(userId: string): string[] {
    const caller = 'gateway';
    if (!this.authService.hasPermission(caller, 'read:users')) {
      throw new Error(`Caller "${caller}" lacks read:users permission`);
    }
    return USER_STORE[userId]?.roles ?? [];
  }

  getUser(userId: string): UserRecord | null {
    const caller = 'gateway';
    if (!this.authService.hasPermission(caller, 'read:users')) {
      throw new Error(`Caller "${caller}" lacks read:users permission`);
    }
    return USER_STORE[userId] ?? null;
  }
}
