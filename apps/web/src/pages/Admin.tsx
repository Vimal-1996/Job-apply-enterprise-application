import { ApiCheck } from '../components/ApiCheck';

export function Admin() {
  return (
    <>
      <header className="page-head">
        <h1>Administration</h1>
        <p>Only members of the admin group can see this page and call these endpoints.</p>
      </header>
      <ApiCheck title="Admin API access" path="/admin/ping" description="The API enforces the admin role on its own." />
    </>
  );
}
