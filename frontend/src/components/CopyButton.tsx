import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be denied by browser permissions — fail silently
      // rather than showing an error for what's a convenience action.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:border-ink/20 hover:text-ink"
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? <Check size={14} className="text-moss" /> : <Copy size={14} />}
      {copied ? 'Copied' : label}
    </button>
  );
}
