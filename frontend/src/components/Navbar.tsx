import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="border-b border-line bg-paper-raised/80 backdrop-blur supports-[backdrop-filter]:bg-paper-raised/60 sticky top-0 z-10">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link to="/" className="font-display text-lg font-semibold tracking-tight text-ink">
          short<span className="text-signal">.link</span>
        </Link>

        <nav className="flex items-center gap-6 text-sm">
          {user ? (
            <>
              <Link to="/dashboard" className="text-ink-muted hover:text-ink transition-colors">
                Your links
              </Link>
              <Link to="/dashboard/api-keys" className="text-ink-muted hover:text-ink transition-colors">
                API keys
              </Link>
              <button
                onClick={() => {
                  logout();
                  navigate('/');
                }}
                className="text-ink-muted hover:text-ink transition-colors"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-ink-muted hover:text-ink transition-colors">
                Log in
              </Link>
              <Link
                to="/signup"
                className="rounded-md bg-ink px-4 py-2 text-white transition-colors hover:bg-ink/90"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
