import { useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { errorMessage } from '../context/AuthContext';
import { CopyButton } from '../components/CopyButton';
import { EmptyState } from '../components/EmptyState';
import type { ApiKeySummary } from '../api/types';

export function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [name, setName] = useState('');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await api.listApiKeys();
      setKeys(res.apiKeys);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.createApiKey(name.trim() || 'Untitled key');
      setFreshKey(res.apiKey.key);
      setName('');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await api.revokeApiKey(id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-2xl font-semibold text-ink">API keys</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Use an API key to create and manage links programmatically. Each key is shown in full only once.
      </p>

      <form onSubmit={handleCreate} className="mt-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={'Key name, e.g. "CI pipeline"'}
          className="flex-1 rounded-md border border-line px-3 py-2.5 text-sm focus:border-signal"
        />
        <button type="submit" className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-ink/90">
          Create key
        </button>
      </form>

      {freshKey && (
        <div className="mt-4 rounded-md border border-signal/30 bg-signal-faint px-4 py-3">
          <p className="text-sm font-medium text-ink">Save this key now — it won't be shown again.</p>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-paper-raised px-3 py-2">
            <code className="truncate font-mono text-xs text-ink">{freshKey}</code>
            <CopyButton value={freshKey} />
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-coral">{error}</p>}

      <div className="mt-10">
        {isLoading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : keys.length === 0 ? (
          <EmptyState title="No API keys yet" description="Create one above to start using the API directly." />
        ) : (
          <div className="border-t border-line">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between border-b border-line py-4 last:border-0">
                <div>
                  <p className="text-sm font-medium text-ink">{key.name}</p>
                  <p className="font-mono text-xs text-ink-muted">{key.keyPreview}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {key.revoked ? 'Revoked' : key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : 'Never used'}
                  </p>
                </div>
                {!key.revoked && (
                  <button
                    onClick={() => handleRevoke(key.id)}
                    className="rounded-md border border-line p-2 text-ink-muted transition-colors hover:border-coral/40 hover:text-coral"
                    aria-label="Revoke key"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
