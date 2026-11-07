import type { ReactNode } from 'react';

export function Spinner({ small = false }: { small?: boolean }) {
  return <span className={small ? 'spinner sm' : 'spinner'} role="status" aria-label="Loading" />;
}

export function FullPage({ children }: { children: ReactNode }) {
  return (
    <div className="center">
      <div className="stack">{children}</div>
    </div>
  );
}

export function Brand() {
  return (
    <span className="brand">
      {/* Logo: an application document, approved (check), with AI assistance (spark). Source: public/logo.svg */}
      <img className="brand-mark" src="/logo.svg" alt="" width={34} height={34} />
      Job Apply
    </span>
  );
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export function Badge({ tone = 'neutral', dot = false, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`badge ${tone === 'neutral' ? '' : tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function initials(email: string | undefined): string {
  if (!email) return '?';
  const name = email.split('@')[0].replace(/[^a-zA-Z]/g, ' ').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || email[0].toUpperCase();
}
