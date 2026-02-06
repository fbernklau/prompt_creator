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
  });
}

bootstrap().catch((error) => {
  console.error('Failed to initialize database', error);
  process.exit(1);
});
