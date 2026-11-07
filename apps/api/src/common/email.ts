import { BadRequestException } from '@nestjs/common';

// Deliberately simple: one @, no spaces, a dot in the domain. Cognito and the
// invitation email are the real test of the address.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalised email from a request body, or a 400. */
export function parseEmail(body: unknown): string {
  const raw = (body as { email?: unknown } | null)?.email;
  if (typeof raw !== 'string') throw new BadRequestException('email is required');
  const email = raw.trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !EMAIL.test(email)) throw new BadRequestException('Invalid email address');
  return email;
}
