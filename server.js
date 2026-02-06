const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 8080;
const databaseUrl = process.env.DATABASE_URL || 'postgresql://prompt:prompt@postgres:5432/prompt_creator';
const authRequired = process.env.AUTH_REQUIRED === 'true';
const requiredGroup = process.env.OIDC_REQUIRED_GROUP || '';

const SETTINGS_DEFAULTS = {
  theme: 'system',
  flowMode: null,
  copyIncludeMetadata: false,
  advancedOpen: false,
};

// Shared PostgreSQL connection pool for all API requests.
const pool = new Pool({ connectionString: databaseUrl });

// Trust Traefik as reverse proxy to preserve forwarded request metadata.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

function splitGroups(value = '') {
  return value
    .split(/[;,| ]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function firstHeader(req, names) {
  for (const name of names) {
    const value = req.header(name);
    if (value) return value;
  }
  return '';
}

function isInRequiredGroup(groups, groupName) {
  if (!groupName) return true;
  const required = groupName.toLowerCase();
  return groups.some((g) => g.toLowerCase() === required);
}

function authMiddleware(req, res, next) {
  const userHeader = firstHeader(req, [
    'x-authentik-username',
    'x-authentik-email',
    'x-forwarded-user',
    'x-auth-request-user',
    'x-forwarded-email',
  ]);
  const groupsHeader = firstHeader(req, [
    'x-authentik-groups',
    'x-forwarded-groups',
    'x-auth-request-groups',
    'x-authentik-entitlements',
  ]);
  const groups = splitGroups(groupsHeader);

  if (authRequired && !userHeader) {
    return res.status(401).json({ error: 'Authentication required via Traefik/OIDC forward auth.' });
  }

  if (authRequired && !isInRequiredGroup(groups, requiredGroup)) {
    return res.status(403).json({ error: `User is not in required group: ${requiredGroup}` });
  }

  req.userId = userHeader || 'local-dev';
  req.userGroups = groups;
  next();
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function clampRating(value) {
  const asNumber = Number(value);
  if (!Number.isInteger(asNumber)) return null;
  if (asNumber < 1 || asNumber > 5) return null;
  return asNumber;
}

function normalizeLibraryRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    promptText: row.prompt_text,
    fach: row.fach,
    handlungsfeld: row.handlungsfeld,
    unterkategorie: row.unterkategorie,
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    avgRating: Number(row.avg_rating || 0),
    ratingCount: Number(row.rating_count || 0),
    myRating: row.my_rating ? Number(row.my_rating) : null,
  };
}

function sanitizeSettings(input = {}) {
  const output = {};
  if (typeof input.theme === 'string' && ['system', 'light', 'dark'].includes(input.theme)) {
    output.theme = input.theme;
  }
  if (typeof input.flowMode === 'string' && ['step', 'single'].includes(input.flowMode)) {
    output.flowMode = input.flowMode;
  }
  if (typeof input.copyIncludeMetadata === 'boolean') {
    output.copyIncludeMetadata = input.copyIncludeMetadata;
  }
  if (typeof input.advancedOpen === 'boolean') {
    output.advancedOpen = input.advancedOpen;
  }
  return output;
}

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

app.get('/api/health', asyncHandler(async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
}));

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ userId: req.userId, groups: req.userGroups });
});

app.get('/api/settings', authMiddleware, asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT settings_json FROM user_settings WHERE user_id = $1', [req.userId]);
  const stored = result.rows[0]?.settings_json || {};
  res.json({ ...SETTINGS_DEFAULTS, ...stored });
}));

app.put('/api/settings', authMiddleware, asyncHandler(async (req, res) => {
  const incoming = sanitizeSettings(req.body || {});
  const existingResult = await pool.query('SELECT settings_json FROM user_settings WHERE user_id = $1', [req.userId]);
  const existing = existingResult.rows[0]?.settings_json || {};
  const merged = { ...SETTINGS_DEFAULTS, ...existing, ...incoming };

  await pool.query(
    `INSERT INTO user_settings (user_id, settings_json)
     VALUES ($1,$2::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = NOW()`,
    [req.userId, JSON.stringify(merged)]
  );

  res.json(merged);
}));

app.get('/api/providers', authMiddleware, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT provider_id, name, kind, model, base_url, key_meta
     FROM providers
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [req.userId]
  );

  res.json(
    result.rows.map((r) => ({
      id: r.provider_id,
      name: r.name,
      kind: r.kind,
      model: r.model,
      baseUrl: r.base_url || '',
      keyMeta: r.key_meta,
    }))
  );
}));

app.put('/api/providers/:providerId', authMiddleware, asyncHandler(async (req, res) => {
  const providerId = req.params.providerId;
  const { name, kind, model, baseUrl, keyMeta } = req.body || {};

  if (!name || !kind || !model || !keyMeta) {
    return res.status(400).json({ error: 'Missing required provider fields.' });
  }

  await pool.query(
    `INSERT INTO providers (user_id, provider_id, name, kind, model, base_url, key_meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, provider_id)
     DO UPDATE SET
       name = EXCLUDED.name,
       kind = EXCLUDED.kind,
       model = EXCLUDED.model,
       base_url = EXCLUDED.base_url,
       key_meta = EXCLUDED.key_meta,
       updated_at = NOW()`,
    [req.userId, providerId, name, kind, model, baseUrl || null, keyMeta]
  );

  res.json({ ok: true });
}));

app.delete('/api/providers/:providerId', authMiddleware, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM providers WHERE user_id = $1 AND provider_id = $2', [req.userId, req.params.providerId]);
  res.json({ ok: true });
}));

app.get('/api/history', authMiddleware, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT fach, handlungsfeld, created_at
     FROM prompt_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 25`,
    [req.userId]
  );

  res.json(
    result.rows.map((r) => ({
      fach: r.fach,
      handlungsfeld: r.handlungsfeld,
      date: new Date(r.created_at).toLocaleString('de-AT'),
    }))
  );
}));

app.post('/api/history', authMiddleware, asyncHandler(async (req, res) => {
  const { fach, handlungsfeld } = req.body || {};
  if (!fach || !handlungsfeld) return res.status(400).json({ error: 'fach and handlungsfeld are required.' });

  await pool.query('INSERT INTO prompt_history (user_id, fach, handlungsfeld) VALUES ($1,$2,$3)', [req.userId, fach, handlungsfeld]);
  res.json({ ok: true });
}));

app.get('/api/library', authMiddleware, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT
       l.*,
       COALESCE(r.avg_rating, 0) AS avg_rating,
       COALESCE(r.rating_count, 0) AS rating_count,
       ur.rating AS my_rating
     FROM prompt_library l
     LEFT JOIN (
       SELECT library_id, ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS rating_count
       FROM prompt_library_ratings
       GROUP BY library_id
     ) r ON r.library_id = l.id
     LEFT JOIN prompt_library_ratings ur ON ur.library_id = l.id AND ur.user_id = $1
     WHERE l.user_id = $1
     ORDER BY l.updated_at DESC`,
    [req.userId]
  );

  res.json(result.rows.map(normalizeLibraryRow));
}));

app.get('/api/library/public', authMiddleware, asyncHandler(async (req, res) => {
  const filters = ['l.is_public = TRUE'];
  const params = [req.userId];
  let idx = 2;

  if (req.query.handlungsfeld) {
    filters.push(`l.handlungsfeld = $${idx++}`);
    params.push(String(req.query.handlungsfeld));
  }
  if (req.query.unterkategorie) {
    filters.push(`l.unterkategorie = $${idx++}`);
    params.push(String(req.query.unterkategorie));
  }
  if (req.query.search) {
    filters.push(`(l.title ILIKE $${idx} OR l.prompt_text ILIKE $${idx})`);
    params.push(`%${String(req.query.search)}%`);
    idx += 1;
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  params.push(limit);

  const result = await pool.query(
    `SELECT
       l.*,
       COALESCE(r.avg_rating, 0) AS avg_rating,
       COALESCE(r.rating_count, 0) AS rating_count,
       ur.rating AS my_rating
     FROM prompt_library l
     LEFT JOIN (
       SELECT library_id, ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS rating_count
       FROM prompt_library_ratings
       GROUP BY library_id
     ) r ON r.library_id = l.id
     LEFT JOIN prompt_library_ratings ur ON ur.library_id = l.id AND ur.user_id = $1
     WHERE ${filters.join(' AND ')}
     ORDER BY l.updated_at DESC
     LIMIT $${params.length}`,
    params
  );

  res.json(result.rows.map(normalizeLibraryRow));
}));

app.post('/api/library', authMiddleware, asyncHandler(async (req, res) => {
  const { title, promptText, fach, handlungsfeld, unterkategorie, isPublic, rating } = req.body || {};
  if (!title || !promptText || !fach || !handlungsfeld || !unterkategorie) {
    return res.status(400).json({ error: 'title, promptText, fach, handlungsfeld and unterkategorie are required.' });
  }

  const insertResult = await pool.query(
    `INSERT INTO prompt_library (user_id, title, prompt_text, fach, handlungsfeld, unterkategorie, is_public)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [req.userId, String(title), String(promptText), String(fach), String(handlungsfeld), String(unterkategorie), Boolean(isPublic)]
  );

  const libraryId = insertResult.rows[0].id;
  const normalizedRating = clampRating(rating);
  if (normalizedRating) {
    await pool.query(
      `INSERT INTO prompt_library_ratings (library_id, user_id, rating)
       VALUES ($1,$2,$3)
       ON CONFLICT (library_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()`,
      [libraryId, req.userId, normalizedRating]
    );
  }

  res.json({ ok: true, id: libraryId });
}));

app.put('/api/library/:id', authMiddleware, asyncHandler(async (req, res) => {
  const libraryId = Number(req.params.id);
  if (!Number.isInteger(libraryId)) return res.status(400).json({ error: 'Invalid library id.' });

  const fields = [];
  const values = [];
  let idx = 1;
  const body = req.body || {};

  if (typeof body.title === 'string' && body.title.trim()) {
    fields.push(`title = $${idx++}`);
    values.push(body.title.trim());
  }
  if (typeof body.promptText === 'string' && body.promptText.trim()) {
    fields.push(`prompt_text = $${idx++}`);
    values.push(body.promptText.trim());
  }
  if (typeof body.fach === 'string' && body.fach.trim()) {
    fields.push(`fach = $${idx++}`);
    values.push(body.fach.trim());
  }
  if (typeof body.handlungsfeld === 'string' && body.handlungsfeld.trim()) {
    fields.push(`handlungsfeld = $${idx++}`);
    values.push(body.handlungsfeld.trim());
  }
  if (typeof body.unterkategorie === 'string' && body.unterkategorie.trim()) {
    fields.push(`unterkategorie = $${idx++}`);
    values.push(body.unterkategorie.trim());
  }
  if (typeof body.isPublic === 'boolean') {
    fields.push(`is_public = $${idx++}`);
    values.push(body.isPublic);
  }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update.' });
  fields.push('updated_at = NOW()');

  values.push(libraryId, req.userId);
  const updateResult = await pool.query(
    `UPDATE prompt_library
     SET ${fields.join(', ')}
     WHERE id = $${idx++} AND user_id = $${idx}
     RETURNING id`,
    values
  );

  if (!updateResult.rowCount) return res.status(404).json({ error: 'Library entry not found.' });
  res.json({ ok: true });
}));

app.put('/api/library/:id/rating', authMiddleware, asyncHandler(async (req, res) => {
  const libraryId = Number(req.params.id);
  const rating = clampRating(req.body?.rating);
  if (!Number.isInteger(libraryId)) return res.status(400).json({ error: 'Invalid library id.' });
  if (!rating) return res.status(400).json({ error: 'rating must be an integer between 1 and 5.' });

  const accessResult = await pool.query(
    `SELECT id FROM prompt_library WHERE id = $1 AND (is_public = TRUE OR user_id = $2)`,
    [libraryId, req.userId]
  );
  if (!accessResult.rowCount) return res.status(404).json({ error: 'Library entry not found.' });

  await pool.query(
    `INSERT INTO prompt_library_ratings (library_id, user_id, rating)
     VALUES ($1,$2,$3)
     ON CONFLICT (library_id, user_id)
     DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()`,
    [libraryId, req.userId, rating]
  );

  res.json({ ok: true });
}));

app.delete('/api/library/:id', authMiddleware, asyncHandler(async (req, res) => {
  const libraryId = Number(req.params.id);
  if (!Number.isInteger(libraryId)) return res.status(400).json({ error: 'Invalid library id.' });

  const deleteResult = await pool.query(
    `DELETE FROM prompt_library WHERE id = $1 AND user_id = $2 RETURNING id`,
    [libraryId, req.userId]
  );
  if (!deleteResult.rowCount) return res.status(404).json({ error: 'Library entry not found.' });
  res.json({ ok: true });
}));

app.use(express.static(path.join(__dirname)));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled API error', error);
  res.status(500).json({ error: 'Internal server error' });
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`prompt-creator server running on :${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });
