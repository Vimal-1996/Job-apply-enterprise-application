function required(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env.local.`);
  return value;
}

export const config = {
  authority: required('VITE_COGNITO_AUTHORITY'),
  clientId: required('VITE_COGNITO_CLIENT_ID'),
  cognitoDomain: required('VITE_COGNITO_DOMAIN'),
  apiUrl: required('VITE_API_URL'),
  appUrl: window.location.origin,
};
