import { Link } from 'react-router-dom';
import { FullPage } from '../components/ui';

export function NotFound() {
  return (
    <FullPage>
      <div className="big-code">404</div>
      <h2>Page not found</h2>
      <p className="muted">The page you're looking for doesn't exist or has moved.</p>
      <Link className="btn btn-primary" to="/">
        Go home
      </Link>
    </FullPage>
  );
}
