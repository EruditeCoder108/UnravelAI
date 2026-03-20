import { TokenPayload } from './TokenIssuer';

export class TokenValidator {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  decode(token: string): TokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(atob(parts[1])) as TokenPayload;
    } catch {
      return null;
    }
  }

  isValid(token: string): boolean {
    const payload = this.decode(token);
    if (!payload) return false;
    if (!payload.sub || !payload.exp) return false;
    return payload.exp > Date.now();
  }
}
