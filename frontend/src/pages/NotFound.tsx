import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="font-display text-4xl font-semibold text-ink">404</p>
      <p className="mt-2 text-sm text-ink-muted">This page doesn't exist.</p>
      <Link to="/" className="mt-6 inline-block text-sm text-signal hover:underline">
        Back home
      </Link>
    </div>
  );
}
