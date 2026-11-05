import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { apiGet } from '../api/client';

/** Calls one API endpoint and shows the raw result, to prove auth end to end. */
export function ApiProbe({ title, path }: { title: string; path: string }) {
  const auth = useAuth();
  const [result, setResult] = useState<string>('Loading…');

  useEffect(() => {
    apiGet<unknown>(path, auth.user?.access_token)
      .then((body) => setResult(JSON.stringify(body, null, 2)))
      .catch((e: Error) => setResult(`Error: ${e.message}`));
  }, [path, auth.user?.access_token]);

  return (
    <section>
      <h2>{title}</h2>
      <p>
        <code>GET {path}</code>
      </p>
      <pre>{result}</pre>
    </section>
  );
}
