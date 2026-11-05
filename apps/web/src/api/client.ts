import { config } from '../config';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Calls the API with the Cognito *access* token (what the API verifies). */
export async function apiGet<T>(path: string, accessToken: string | undefined): Promise<T> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
