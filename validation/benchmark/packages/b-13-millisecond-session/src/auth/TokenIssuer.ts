export interface TokenPayload {
  sub: string;
  role: 'user' | 'admin';
  iat: number;
  exp: number;
}

export interface IssuedToken {
  token: string;
  payload: TokenPayload;
}

export class TokenIssuer {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  issue(userId: string, role: 'user' | 'admin', ttlSeconds: number): IssuedToken {
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = {
      sub: userId,
      role,
      iat: now,
      exp: now + ttlSeconds,
    };

    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    const signature = btoa(`${this.secret}:${header}.${body}`);
    const token = `${header}.${body}.${signature}`;

    return { token, payload };
  }
}
