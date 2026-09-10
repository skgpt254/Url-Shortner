import { Link } from 'react-router-dom';
import { BarChart3, Lock, Trash2 } from 'lucide-react';
import type { LinkPublic } from '../api/types';
import { CopyButton } from './CopyButton';
import { StatusBadge } from './StatusBadge';

export function LinkRow({ link, onDelete }: { link: LinkPublic; onDelete: (code: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 border-b border-line py-4 last:border-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={link.shortUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate font-mono text-sm font-medium text-signal hover:underline"
          >
            {link.shortUrl.replace(/^https?:\/\//, '')}
          </a>
          {link.hasPassword && <Lock size={13} className="shrink-0 text-ink-faint" aria-label="Password protected" />}
          <StatusBadge status={link.status} />
        </div>
        <p className="mt-0.5 truncate text-sm text-ink-muted">{link.destinationUrl}</p>
      </div>

      <div className="flex items-center gap-4 sm:justify-end">
        <div className="text-right text-sm">
          <p className="font-medium text-ink">{link.clickCount.toLocaleString()}</p>
          <p className="text-xs text-ink-muted">clicks</p>
        </div>
        <CopyButton value={link.shortUrl} />
        <Link
          to={`/dashboard/links/${link.shortCode}`}
          className="rounded-md border border-line p-2 text-ink-muted transition-colors hover:border-ink/20 hover:text-ink"
          aria-label="View analytics"
        >
          <BarChart3 size={16} />
        </Link>
        <button
          onClick={() => onDelete(link.shortCode)}
          className="rounded-md border border-line p-2 text-ink-muted transition-colors hover:border-coral/40 hover:text-coral"
          aria-label="Delete link"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
