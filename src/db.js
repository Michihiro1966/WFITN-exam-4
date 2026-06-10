'use strict';

const { Pool } = require('pg');
const { config } = require('./config');

if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set. Add a PostgreSQL service and set DATABASE_URL in Railway variables.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      given_name TEXT NOT NULL,
      family_name TEXT NOT NULL,
      gender TEXT NOT NULL,
      email TEXT NOT NULL,
      institute TEXT NOT NULL,
      years_post_graduation INTEGER NOT NULL,
      subspeciality TEXT NOT NULL,
      started_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      score INTEGER,
      total INTEGER,
      late_seconds INTEGER DEFAULT 0,
      feedback_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS responses (
      participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL,
      selected JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_correct BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (participant_id, question_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_participants_submitted_at ON participants(submitted_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_responses_question_id ON responses(question_id);`);
}

async function query(text, params) {
  return pool.query(text, params);
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb, query, transaction };
