import { useEffect, useState, useCallback } from 'react';
import { ShortenForm } from '../components/ShortenForm';
import { LinkRow } from '../components/LinkRow';
import { EmptyState } from '../components/EmptyState';
import { api } from '../api/client';
import { errorMessage } from '../context/AuthContext';
import type { LinkPublic } from '../api/types';

export function Dashboard() {
  const [links, setLinks] = useState<LinkPublic[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.listLinks();
      setLinks(res.links);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (!nextCursor) return;
    const res = await api.listLinks({ cursor: nextCursor });
    setLinks((prev) => [...prev, ...res.links]);
    setNextCursor(res.nextCursor);
  };

  const handleCreated = (link: LinkPublic) => {
    setLinks((prev) => [link, ...prev]);
  };

  const handleDelete = async (code: string) => {
    const previous = links;
    setLinks((prev) => prev.filter((l) => l.shortCode !== code)); // optimistic
    try {
      await api.deleteLink(code);
    } catch (err) {
      setLinks(previous); // roll back on failure
      setError(errorMessage(err));
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-2xl font-semibold text-ink">Your links</h1>

      <div className="mt-6">
        <ShortenForm mode="authenticated" onCreated={handleCreated} />
      </div>

      {error && <p className="mt-4 text-sm text-coral">{error}</p>}

      <div className="mt-10">
        {isLoading ? (
          <p className="text-sm text-ink-muted">Loading your links…</p>
        ) : links.length === 0 ? (
          <EmptyState
            title="No links yet"
            description="Shorten your first link above — it'll show up here with click tracking and edit controls."
          />
        ) : (
          <>
            <div className="border-t border-line">
              {links.map((link) => (
                <LinkRow key={link.shortCode} link={link} onDelete={handleDelete} />
              ))}
            </div>
            {nextCursor && (
              <button
                onClick={loadMore}
                className="mt-4 w-full rounded-md border border-line py-2 text-sm text-ink-muted transition-colors hover:border-ink/20 hover:text-ink"
              >
                Load more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
