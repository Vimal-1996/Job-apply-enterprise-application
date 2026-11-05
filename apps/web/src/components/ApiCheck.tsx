import { useCallback, useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { ApiError, apiGet } from '../api/client';
import { Badge, Spinner } from './ui';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; body: unknown; ms: number }
  | { kind: 'error'; status?: number; message: string };

const STATUS_TEXT: Record<number, string> = {
  401: 'Not signed in or token expired',
  403: 'Signed in, but your role does not allow this',
};

/** Calls an API endpoint with the user's access token and shows the outcome. */
export function ApiCheck({ title, path, description }: { title: string; path: string; description: string }) {
  const auth = useAuth();
  const token = auth.user?.access_token;
  const [state, setState] = useState<State>({ kind: 'loading' });

  const run = useCallback(async () => {
    setState({ kind: 'loading' });
    const started = performance.now();
    try {
      const body = await apiGet<unknown>(path, token);
      setState({ kind: 'ok', body, ms: Math.round(performance.now() - started) });
    } catch (e) {
      if (e instanceof ApiError) setState({ kind: 'error', status: e.status, message: STATUS_TEXT[e.status] ?? e.message });
      else setState({ kind: 'error', message: 'API unreachable. Is it running on the configured URL?' });
    }
  }, [path, token]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="card">
      <div className="row">
        <h3>{title}</h3>
        <span className="spacer" />
        {state.kind === 'loading' && <Spinner small />}
        {state.kind === 'ok' && (
          <Badge tone="success" dot>
            200 OK · {state.ms} ms
          </Badge>
        )}
        {state.kind === 'error' && (
          <Badge tone="danger" dot>
            {state.status ?? 'Network error'}
          </Badge>
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {description} <code>GET {path}</code>
      </p>
      {state.kind === 'loading' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="skeleton" style={{ width: '70%' }} />
          <div className="skeleton" style={{ width: '45%' }} />
        </div>
      )}
      {state.kind === 'ok' && <pre className="json">{JSON.stringify(state.body, null, 2)}</pre>}
      {state.kind === 'error' && <p style={{ margin: 0, color: 'var(--danger)' }}>{state.message}</p>}
      <div>
        <button className="btn btn-ghost" onClick={() => void run()} disabled={state.kind === 'loading'}>
          ↻ Run again
        </button>
      </div>
    </div>
  );
}
