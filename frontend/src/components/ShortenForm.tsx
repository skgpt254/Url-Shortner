import { useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../api/client';
import { errorMessage } from '../context/AuthContext';
import type { LinkPublic } from '../api/types';

interface ShortenFormProps {
  mode: 'anonymous' | 'authenticated';
  onCreated: (link: LinkPublic) => void;
}

export function ShortenForm({ mode, onCreated }: ShortenFormProps) {
  const [url, setUrl] = useState('');
  const [customAlias, setCustomAlias] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [password, setPassword] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { link } =
        mode === 'anonymous'
          ? await api.quickShorten(url)
          : await api.createLink({
              url,
              customAlias: customAlias.trim() || undefined,
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
              password: password.trim() || undefined,
            });
      onCreated(link);
      setUrl('');
      setCustomAlias('');
      setExpiresAt('');
      setPassword('');
      setShowAdvanced(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a long URL"
          className="flex-1 rounded-md border border-line bg-paper-raised px-4 py-3 text-ink placeholder:text-ink-faint focus:border-signal"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-signal px-6 py-3 font-medium text-white transition-colors hover:bg-signal-hover disabled:opacity-60"
        >
          {isSubmitting ? 'Shortening…' : 'Shorten'}
        </button>
      </div>

      {mode === 'authenticated' && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            Options {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAdvanced && (
            <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-line p-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-muted">Custom alias</span>
                <input
                  value={customAlias}
                  onChange={(e) => setCustomAlias(e.target.value)}
                  placeholder="spring-sale"
                  className="rounded-md border border-line px-3 py-2 font-mono text-sm placeholder:font-body"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-muted">Expires on</span>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="rounded-md border border-line px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-muted">Password (optional)</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank for none"
                  className="rounded-md border border-line px-3 py-2 text-sm"
                />
              </label>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-coral">{error}</p>}
    </form>
  );
}
