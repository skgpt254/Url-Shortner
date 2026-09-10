import type { LinkPublic } from '../api/types';

const STYLES: Record<LinkPublic['status'], { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-moss-faint text-moss' },
  disabled: { label: 'Disabled', className: 'bg-line/60 text-ink-muted' },
  expired: { label: 'Expired', className: 'bg-amber-faint text-amber' },
  pending_review: { label: 'Under review', className: 'bg-amber-faint text-amber' },
  blocked: { label: 'Blocked', className: 'bg-coral-faint text-coral' },
};

export function StatusBadge({ status }: { status: LinkPublic['status'] }) {
  const { label, className } = STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
