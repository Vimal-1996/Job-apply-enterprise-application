import { useEffect, useRef, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { signOut } from '../auth/signOut';
import { groupsFromProfile } from '../auth/roles';
import { Badge, initials } from './ui';

export function UserMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const email = auth.user?.profile.email;
  const groups = groupsFromProfile(auth.user?.profile);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button className="avatar-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{initials(email)}</span>
        <span className="who">{email}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <div className="email">{email}</div>
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              {groups.length ? groups.map((g) => <Badge key={g} tone="primary">{g}</Badge>) : <Badge>no role</Badge>}
            </div>
          </div>
          <Link to="/account" role="menuitem" onClick={() => setOpen(false)}>
            👤 Account & security
          </Link>
          <button role="menuitem" className="danger" onClick={() => void signOut(auth)}>
            ⎋ Sign out
          </button>
        </div>
      )}
    </div>
  );
}
