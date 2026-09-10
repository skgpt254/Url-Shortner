/**
 * Run monthly (e.g. via a k8s CronJob) to create the click_events partition
 * for 2 months ahead. The initial migration bootstraps the current + next
 * 2 months, but that head start erodes over time — this script is what
 * keeps it from ever running out. Safe to run repeatedly (CREATE TABLE IF
 * NOT EXISTS semantics).
 */
import pg from 'pg';
import 'dotenv/config';

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const target = new Date();
    target.setMonth(target.getMonth() + 2);
    const partitionStart = new Date(target.getFullYear(), target.getMonth(), 1);
    const partitionEnd = new Date(target.getFullYear(), target.getMonth() + 1, 1);
    const partitionName = `click_events_${partitionStart.getFullYear()}_${String(partitionStart.getMonth() + 1).padStart(2, '0')}`;

    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF click_events FOR VALUES FROM ($1) TO ($2)`,
      [partitionStart.toISOString(), partitionEnd.toISOString()]
    );
    console.log(`Ensured partition ${partitionName} exists (${partitionStart.toISOString()} - ${partitionEnd.toISOString()})`);

    // Also purge raw click_events partitions past the retention window —
    // dropping a whole partition is an O(1) metadata operation, unlike a
    // row-by-row DELETE which would bloat the table and thrash the WAL.
    const retentionDays = Number(process.env.CLICK_EVENT_RETENTION_DAYS ?? 90);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE tablename LIKE 'click_events_%'`
    );
    for (const { tablename } of rows) {
      const match = /click_events_(\d{4})_(\d{2})/.exec(tablename);
      if (!match) continue;
      const partitionDate = new Date(Number(match[1]), Number(match[2]) - 1, 1);
      // Only drop partitions entirely in the past relative to the cutoff —
      // a partition's month must have fully ended before the retention
      // window to be safe to drop.
      const partitionEndDate = new Date(partitionDate.getFullYear(), partitionDate.getMonth() + 1, 1);
      if (partitionEndDate < cutoff) {
        console.log(`Dropping expired partition ${tablename} (older than ${retentionDays} days)`);
        await pool.query(`DROP TABLE IF EXISTS ${tablename}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
