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
    const status = Number(error?.status);
    const normalizedStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
    res.status(normalizedStatus).json({ error: error?.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
