const { pool } = require('./pool');

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS providers (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      base_url TEXT,
      key_meta JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, provider_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_history (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      fach TEXT NOT NULL,
      handlungsfeld TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_library (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      fach TEXT NOT NULL,
      handlungsfeld TEXT NOT NULL,
      unterkategorie TEXT NOT NULL,
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_library_ratings (
      id BIGSERIAL PRIMARY KEY,
      library_id BIGINT NOT NULL REFERENCES prompt_library(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(library_id, user_id)
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_prompt_library_user ON prompt_library(user_id, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_prompt_library_public ON prompt_library(is_public, updated_at DESC)');
}

module.exports = { initDb };
