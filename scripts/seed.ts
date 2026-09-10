import 'dotenv/config';
import { pool } from '../src/db/client.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import { generateApiKey } from '../src/modules/auth/apikey.service.js';

async function main() {
  const email = 'demo@example.com';
  const password = 'demo-password-123';

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  let userId: string;

  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    console.log(`Demo user already exists (id=${userId})`);
  } else {
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, 'Demo User') RETURNING id`,
      [email, passwordHash]
    );
    userId = rows[0]!.id;
    console.log(`Created demo user ${email} / ${password} (id=${userId})`);
  }

  const { fullKey, keyPrefix, secretHash } = generateApiKey('test');
  await pool.query(
    `INSERT INTO api_keys (user_id, name, key_prefix, secret_hash, scopes) VALUES ($1, 'seed-script-key', $2, $3, $4)`,
    [userId, keyPrefix, secretHash, ['links:read', 'links:write']]
  );

  console.log('\n── Demo API key (save this now, it will not be shown again) ──');
  console.log(fullKey);
  console.log('\nTry it:');
  console.log(`curl -X POST http://localhost:3000/api/v1/links \\
  -H "Authorization: Bearer ${fullKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com"}'`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
