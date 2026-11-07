/**
 * Admin console sections. To add a feature: add an entry here and a matching
 * <Route> under /admin in App.tsx. `soon` entries render disabled.
 */
export interface AdminSection {
  to: string;
  label: string;
  icon: string;
  description: string;
  soon?: boolean;
}

export interface AdminGroup {
  title: string;
  items: AdminSection[];
}

export const ADMIN_NAV: AdminGroup[] = [
  {
    title: 'General',
    items: [{ to: '/admin', label: 'Overview', icon: '◧', description: 'Summary of the platform' }],
  },
  {
    title: 'Identity & access',
    items: [
      { to: '/admin/users', label: 'Users', icon: '👥', description: 'Accounts, roles and status' },
      { to: '/admin/audit', label: 'Audit log', icon: '🧾', description: 'Who did what, and when', soon: true },
    ],
  },
  {
    title: 'Automation',
    items: [
      { to: '/admin/agents', label: 'Agent runs', icon: '🤖', description: 'Scheduled agent activity', soon: true },
      { to: '/admin/connectors', label: 'Connectors', icon: '🔌', description: 'Job platform integrations', soon: true },
    ],
  },
  {
    title: 'System',
    items: [{ to: '/admin/settings', label: 'Settings', icon: '⚙️', description: 'Platform configuration', soon: true }],
  },
];
