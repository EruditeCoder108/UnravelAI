import { AuthService } from './auth/AuthService';
import { UserService } from './users/UserService';
import { Gateway } from './gateway/Gateway';

export function createApp(): Gateway {
  const userService = new UserService(null as unknown as AuthService);
  const authService = new AuthService(userService);
  return new Gateway(authService);
}
