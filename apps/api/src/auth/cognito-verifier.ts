import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { TokenVerifier } from './auth.types';

/** Verifies Cognito *access* tokens (signature via cached JWKS, issuer, expiry, client). */
export function createCognitoVerifier(userPoolId: string, clientId: string): TokenVerifier {
  const verifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: 'access', clientId });
  return {
    async verify(token) {
      const p = await verifier.verify(token);
      return {
        sub: p.sub,
        client_id: p.client_id,
        'cognito:groups': p['cognito:groups'] as string[] | undefined,
      };
    },
  };
}
