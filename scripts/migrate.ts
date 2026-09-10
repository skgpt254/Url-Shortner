/**
 * Minimal migration runner. We deliberately avoid a heavy migration
 * framework: schema changes here are infrequent and reviewed by hand,
 * and a 100-line runner is easier to audit than a black-box dependency.
 *
 * Convention: files in src/db/migrations/NNN_description.sql are applied
 * in ascending numeric order, exactly once, tracked in a `schema_migrations`
 * table. There is no auto-generated "down" - rollback files are optional
 * and named NNN_description.down.sql.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');

async function ensureMigrationsTable(client: pg.PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort(); // filenames are zero-padded, lexical sort == numeric sort
}

async function up(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    for (const file of listMigrationFiles()) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      console.log(`Applying ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✔ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✘ ${file} failed:`, err);
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

async function down(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1'
    );
    const last = rows[0]?.filename;
    if (!last) {
      console.log('No migrations to roll back.');
      return;
    }
    const downFile = last.replace(/\.sql$/, '.down.sql');
    const downPath = join(MIGRATIONS_DIR, downFile);
    if (!existsSync(downPath)) {
      throw new Error(`No down-migration found for ${last} (expected ${downFile})`);
    }
    const sql = readFileSync(downPath, 'utf-8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE filename = $1', [last]);
      await client.query('COMMIT');
      console.log(`Rolled back ${last}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}

async function status(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    for (const file of listMigrationFiles()) {
      console.log(`${applied.has(file) ? '✔' : ' '}  ${file}`);
    }
  } finally {
    client.release();
  }
}

async function main() {
  const cmd = process.argv[2];
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (cmd === 'up') await up(pool);
    else if (cmd === 'down') await down(pool);
    else if (cmd === 'status') await status(pool);
    else {
      console.error('Usage: migrate.ts <up|down|status>');
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
