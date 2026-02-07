const path = require('path');
const { createApp } = require('./src/create-app');
const { config } = require('./src/config');
const { initDb } = require('./src/db/init-db');

async function bootstrap() {
  await initDb();

  const app = createApp({
    staticDir: path.join(__dirname),
  });

  app.listen(config.port, () => {
    console.log(`prompt-creator server running on :${config.port}`);
    console.log(`auth required: ${config.authRequired ? 'yes' : 'no'} | required group: ${config.requiredGroup || '(none)'}`);
    if (config.keyEncryptionSecret === 'insecure-dev-key-change-me') {
      console.warn('WARNING: KEY_ENCRYPTION_SECRET is using insecure default. Set a strong value in production.');
    }
  });
}

bootstrap().catch((error) => {
  console.error('Failed to initialize database', error);
  process.exit(1);
});
