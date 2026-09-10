import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api/client';
import { errorMessage } from '../context/AuthContext';
import { ClickChart } from '../components/ClickChart';
import { CopyButton } from '../components/CopyButton';
import type { LinkAnalytics, LinkPublic } from '../api/types';

export function LinkDetail() {
  const { code } = useParams<{ code: string }>();
  const [link, setLink] = useState<LinkPublic | null>(null);
  const [analytics, setAnalytics] = useState<LinkAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    (async () => {
      try {
        const [linksRes, analyticsRes] = await Promise.all([api.listLinks(), api.getAnalytics(code)]);
        const found = linksRes.links.find((l) => l.shortCode === code) ?? null;
        setLink(found);
        setAnalytics(analyticsRes.analytics);
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [code]);

  if (error) return <p className="mx-auto max-w-3xl px-6 py-12 text-sm text-coral">{error}</p>;
  if (!link || !analytics) return <p className="mx-auto max-w-3xl px-6 py-12 text-sm text-ink-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft size={14} /> Back to links
      </Link>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-lg font-medium text-signal">{link.shortUrl}</p>
          <p className="mt-0.5 truncate text-sm text-ink-muted">{link.destinationUrl}</p>
        </div>
        <CopyButton value={link.shortUrl} />
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total clicks" value={analytics.totalClicks} />
        <Stat label="Unique visitors" value={analytics.uniqueVisitors} />
        <Stat label="Redirect type" value={link.redirectType} />
        <Stat label="Created" value={new Date(link.createdAt).toLocaleDateString()} />
      </div>

      <div className="mt-8">
        <h2 className="font-display text-base font-medium text-ink">Clicks over time</h2>
        <div className="mt-3">
          <ClickChart data={analytics.byDay} />
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-8 border-t border-line pt-8 sm:grid-cols-3">
        <BreakdownList title="Top referrers" items={analytics.topReferrers.map((r) => ({ label: r.referrerHost ?? 'Direct', value: r.clicks }))} />
        <BreakdownList title="Top countries" items={analytics.topCountries.map((c) => ({ label: c.countryCode ?? 'Unknown', value: c.clicks }))} />
        <BreakdownList title="Devices" items={analytics.deviceBreakdown.map((d) => ({ label: d.deviceType, value: d.clicks }))} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="font-display text-2xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}

function BreakdownList({ title, items }: { title: string; items: Array<{ label: string; value: number }> }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-faint">No data yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.label} className="flex items-center justify-between text-sm">
              <span className="text-ink-muted">{item.label}</span>
              <span className="font-medium text-ink">{item.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
