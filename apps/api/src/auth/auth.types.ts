export type Role = 'admin' | 'user';

export interface AuthUser {
  /** Cognito user id (the `sub` claim). */
  id: string;
  groups: Role[];
  clientId: string;
}

/** Verifies a bearer token and returns its claims. Injectable so tests can fake it. */
export interface TokenVerifier {
  verify(token: string): Promise<{ sub: string; 'cognito:groups'?: string[]; client_id: string }>;
}

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');
