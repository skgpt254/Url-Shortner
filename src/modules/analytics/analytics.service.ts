import { createHash } from 'node:crypto';
import { UAParser } from 'ua-parser-js';
import geoip from 'geoip-lite';
import { pool } from '../../db/client.js';
import { config } from '../../config/index.js';
import type { ClickEventJob } from '../../queue/click-queue.js';

/**
 * PRIVACY: we never store a visitor's raw IP address. We store a salted
 * SHA-256 hash of it (for rough unique-visitor counting within a day —
 * see click_daily_rollup) plus a coarse geo lookup (country/city) derived
 * from it at ingestion time. The raw IP itself is discarded the moment
 * this function returns. This keeps the system GDPR-friendlier by
 * default: even a full database compromise doesn't expose visitor IPs.
 */
function hashIp(ip: string): string {
  return createHash('sha256').update(ip + config.ipHashSalt).digest('hex');
}

const BOT_UA_PATTERN = /bot|crawler|spider|slurp|facebookexternalhit|whatsapp|telegrambot|curl|wget/i;

export async function processClickEvent(job: ClickEventJob): Promise<void> {
  const ipHash = hashIp(job.ip);
  const geo = geoip.lookup(job.ip);
  const parser = new UAParser(job.userAgent ?? undefined);
  const device = parser.getDevice();
  const browser = parser.getBrowser();
  const os = parser.getOS();
  const isBot = job.userAgent ? BOT_UA_PATTERN.test(job.userAgent) : false;

  let referrerHost: string | null = null;
  if (job.referrer) {
    try {
      referrerHost = new URL(job.referrer).hostname;
    } catch {
      referrerHost = null;
    }
  }

  await pool.query(
    `INSERT INTO click_events
       (link_id, clicked_at, ip_hash, country_code, city, device_type, browser, os, referrer_host, is_bot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      job.linkId,
      job.clickedAt,
      ipHash,
      geo?.country ?? null,
      geo?.city ?? null,
      device.type ?? 'desktop',
      browser.name ?? 'unknown',
      os.name ?? 'unknown',
      referrerHost,
      isBot,
    ]
  );

  // Upsert the daily rollup. `unique_visitors` here is an approximation
  // (count of distinct ip_hash values seen that day for this link) — for
  // very high-traffic links, swapping this for a HyperLogLog-based
  // approximate-distinct-count (Redis PFADD/PFCOUNT) would avoid the
  // per-click rollup query entirely; noted as a scaling extension point in
  // the README once daily click volume per link exceeds ~100k.
  const day = job.clickedAt.slice(0, 10); // YYYY-MM-DD
  await pool.query(
    `INSERT INTO click_daily_rollup (link_id, day, clicks, unique_visitors)
     VALUES ($1, $2, 1,
       (SELECT COUNT(DISTINCT ip_hash) FROM click_events
         WHERE link_id = $1 AND clicked_at::date = $2::date))
     ON CONFLICT (link_id, day)
     DO UPDATE SET
       clicks = click_daily_rollup.clicks + 1,
       unique_visitors = EXCLUDED.unique_visitors`,
    [job.linkId, day]
  );
}

export interface LinkAnalyticsSummary {
  totalClicks: number;
  uniqueVisitors: number;
  byDay: Array<{ day: string; clicks: number; uniqueVisitors: number }>;
  topReferrers: Array<{ referrerHost: string | null; clicks: number }>;
  topCountries: Array<{ countryCode: string | null; clicks: number }>;
  deviceBreakdown: Array<{ deviceType: string; clicks: number }>;
}

export async function getLinkAnalytics(linkId: string, days: number): Promise<LinkAnalyticsSummary> {
  const [rollup, referrers, countries, devices] = await Promise.all([
    pool.query<{ day: string; clicks: string; unique_visitors: string }>(
      `SELECT day, clicks, unique_visitors FROM click_daily_rollup
        WHERE link_id = $1 AND day >= now() - ($2 || ' days')::interval
        ORDER BY day ASC`,
      [linkId, days]
    ),
    pool.query<{ referrer_host: string | null; clicks: string }>(
      `SELECT referrer_host, COUNT(*) AS clicks FROM click_events
        WHERE link_id = $1 AND clicked_at >= now() - ($2 || ' days')::interval AND is_bot = FALSE
        GROUP BY referrer_host ORDER BY clicks DESC LIMIT 10`,
      [linkId, days]
    ),
    pool.query<{ country_code: string | null; clicks: string }>(
      `SELECT country_code, COUNT(*) AS clicks FROM click_events
        WHERE link_id = $1 AND clicked_at >= now() - ($2 || ' days')::interval AND is_bot = FALSE
        GROUP BY country_code ORDER BY clicks DESC LIMIT 10`,
      [linkId, days]
    ),
    pool.query<{ device_type: string; clicks: string }>(
      `SELECT device_type, COUNT(*) AS clicks FROM click_events
        WHERE link_id = $1 AND clicked_at >= now() - ($2 || ' days')::interval AND is_bot = FALSE
        GROUP BY device_type ORDER BY clicks DESC`,
      [linkId, days]
    ),
  ]);

  const totalClicks = rollup.rows.reduce((sum, r) => sum + Number(r.clicks), 0);
  const uniqueVisitors = rollup.rows.reduce((sum, r) => sum + Number(r.unique_visitors), 0);

  return {
    totalClicks,
    uniqueVisitors,
    byDay: rollup.rows.map((r) => ({ day: r.day, clicks: Number(r.clicks), uniqueVisitors: Number(r.unique_visitors) })),
    topReferrers: referrers.rows.map((r) => ({ referrerHost: r.referrer_host, clicks: Number(r.clicks) })),
    topCountries: countries.rows.map((r) => ({ countryCode: r.country_code, clicks: Number(r.clicks) })),
    deviceBreakdown: devices.rows.map((r) => ({ deviceType: r.device_type, clicks: Number(r.clicks) })),
  };
}
