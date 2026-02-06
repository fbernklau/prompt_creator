const express = require('express');
const path = require('path');
const { createApiRouter } = require('./routes/api-routes');

function createApp({ staticDir }) {
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createApiRouter());

  app.use(express.static(staticDir));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    console.error('Unhandled API error', error);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
