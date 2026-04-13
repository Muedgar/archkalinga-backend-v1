/**
 * DB Reset Script
 *
 * Drops and recreates the ArchKalinga database from scratch, then installs
 * the uuid-ossp extension required by AppBaseEntity's default UUID generation.
 *
 * Usage:  npm run db:reset
 *
 * ⚠️  DESTRUCTIVE — all data will be lost. Dev / CI only.
 */
import { config as dotenvConfig } from 'dotenv';
import { Client } from 'pg';

dotenvConfig({ path: '.env' });

const DB_NAME = process.env.POSTGRES_DB as string;

/** Connection to the Postgres server itself (not the target DB). */
const serverConn = {
  host: process.env.POSTGRES_HOST as string,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER as string,
  password: process.env.POSTGRES_PASSWORD ?? '',
  database: 'postgres',
};

async function resetDatabase(): Promise<void> {
  // ── Step 1: Drop and recreate the database ──────────────────────────────
  const serverClient = new Client(serverConn);
  await serverClient.connect();

  console.log(`\n🗑  Dropping database "${DB_NAME}" (if it exists)…`);
  // WITH (FORCE) terminates existing connections before dropping (Postgres ≥ 13)
  await serverClient.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);

  console.log(`🏗  Creating database "${DB_NAME}"…`);
  await serverClient.query(`CREATE DATABASE "${DB_NAME}"`);
  await serverClient.end();

  // ── Step 2: Install uuid-ossp extension in the fresh DB ─────────────────
  const dbClient = new Client({ ...serverConn, database: DB_NAME });
  await dbClient.connect();

  console.log(`🔌 Installing uuid-ossp extension…`);
  await dbClient.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await dbClient.end();

  console.log(`\n✅ Database "${DB_NAME}" has been reset and is ready.\n`);
}

resetDatabase().catch((err: Error) => {
  console.error('\n❌ Database reset failed:', err.message);
  process.exit(1);
});
