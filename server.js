const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 8080;
const databaseUrl = process.env.DATABASE_URL || 'postgresql://prompt:prompt@postgres:5432/prompt_creator';
const authRequired = process.env.AUTH_REQUIRED === 'true';
const requiredGroup = process.env.OIDC_REQUIRED_GROUP || '';

const pool = new Pool({ connectionString: databaseUrl });

app.use(express.json({ limit: '1mb' }));

function splitGroups(value = '') {
  return value
    .split(/[;, ]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function authMiddleware(req, res, next) {
  const userHeader = req.header('x-forwarded-user') || req.header('x-auth-request-user') || req.header('x-forwarded-email') || '';
  const groupsHeader = req.header('x-forwarded-groups') || req.header('x-auth-request-groups') || '';
  const groups = splitGroups(groupsHeader);

  if (authRequired && !userHeader) {
    return res.status(401).json({ error: 'Authentication required via Traefik/OIDC forward auth.' });
  }

  if (requiredGroup && authRequired && !groups.includes(requiredGroup)) {
    return res.status(403).json({ error: `User is not in required group: ${requiredGroup}` });
  }

  req.userId = userHeader || 'local-dev';
  req.userGroups = groups;
  next();
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
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ userId: req.userId, groups: req.userGroups });
});

app.get('/api/providers', authMiddleware, async (req, res) => {
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
});

app.put('/api/providers/:providerId', authMiddleware, async (req, res) => {
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
});

app.delete('/api/providers/:providerId', authMiddleware, async (req, res) => {
  await pool.query('DELETE FROM providers WHERE user_id = $1 AND provider_id = $2', [req.userId, req.params.providerId]);
  res.json({ ok: true });
});

app.get('/api/history', authMiddleware, async (req, res) => {
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
});

app.post('/api/history', authMiddleware, async (req, res) => {
  const { fach, handlungsfeld } = req.body || {};
  if (!fach || !handlungsfeld) return res.status(400).json({ error: 'fach and handlungsfeld are required.' });

  await pool.query('INSERT INTO prompt_history (user_id, fach, handlungsfeld) VALUES ($1,$2,$3)', [req.userId, fach, handlungsfeld]);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname)));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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
