import { Link } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';

export function NotFound() {
  return (
    <div className="min-h-full">
      <AppHeader />
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="font-display text-6xl">Off route</h1>
        <p className="mt-2 text-ink-400">This page doesn't exist.</p>
        <Link to="/" className="btn btn-primary mt-6">
          Back home
        </Link>
      </div>
    </div>
  );
}
