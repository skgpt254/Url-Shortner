import { pool } from '../../db/client.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  role: 'user' | 'admin';
  is_active: boolean;
  token_version: number;
  created_at: string;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function createUser(email: string, passwordHash: string, displayName: string | null): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING *`,
    [email, passwordHash, displayName]
  );
  return rows[0]!;
}

export async function bumpTokenVersion(userId: string): Promise<void> {
  await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
}
