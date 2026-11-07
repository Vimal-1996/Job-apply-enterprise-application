export type Role = 'admin' | 'user';

/** Read Cognito groups from the ID token claims. UI-only: the API enforces roles itself. */
export function groupsFromProfile(profile: Record<string, unknown> | undefined): Role[] {
  const raw = profile?.['cognito:groups'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((g): g is Role => g === 'admin' || g === 'user');
}

/** MFA is required for administrators only; normal users sign in with a password. */
export function requiresMfa(groups: Role[]): boolean {
  return groups.includes('admin');
}

export function hasAnyRole(groups: Role[], required: Role[]): boolean {
  return required.length === 0 || required.some((r) => groups.includes(r));
}
