import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ShortenForm } from '../components/ShortenForm';
import { CopyButton } from '../components/CopyButton';
import { useAuth } from '../context/AuthContext';
import type { LinkPublic } from '../api/types';

const FEATURES = [
  {
    title: 'Custom aliases',
    body: 'Replace the random code with something readable — spring-sale instead of x7Tq2p.',
  },
  {
    title: 'Click analytics',
    body: 'See where clicks come from: referrers, countries, and devices, updated in real time.',
  },
  {
    title: 'Expiring & protected links',
    body: 'Set an expiry date, cap the number of clicks, or require a password before redirecting.',
  },
];

export function Landing() {
  const { user } = useAuth();
  const [justCreated, setJustCreated] = useState<LinkPublic | null>(null);

  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <div className="mb-3 h-px w-12 bg-signal" aria-hidden />
      <h1 className="max-w-xl font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">
        Turn long links into ones worth sharing.
      </h1>
      <p className="mt-4 max-w-prose text-ink-muted">
        Paste any URL below to get a short link instantly. Sign up to add custom aliases, track
        clicks, and manage everything from one place.
      </p>

      <div className="mt-8">
        <ShortenForm mode="anonymous" onCreated={setJustCreated} />
      </div>

      {justCreated && (
        <div className="mt-4 flex animate-slide-in items-center justify-between gap-4 rounded-md border border-line bg-paper-raised px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-medium text-signal">{justCreated.shortUrl}</p>
            <p className="truncate text-xs text-ink-muted">{justCreated.destinationUrl}</p>
          </div>
          <CopyButton value={justCreated.shortUrl} />
        </div>
      )}

      {justCreated && !user && (
        <p className="mt-3 text-sm text-ink-muted">
          Want to edit this link, set an expiry, or see click analytics?{' '}
          <RouterLink to="/signup" className="text-signal hover:underline">
            Create a free account
          </RouterLink>{' '}
          — anonymous links can't be edited or tracked later.
        </p>
      )}

      <div className="mt-20 grid grid-cols-1 gap-8 border-t border-line pt-10 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title}>
            <h3 className="font-display text-base font-medium text-ink">{f.title}</h3>
            <p className="mt-1.5 text-sm text-ink-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
