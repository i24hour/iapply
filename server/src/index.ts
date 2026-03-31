import { app } from './app.js';

const PORT = process.env.PORT || 3001;

process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});

async function start() {
  const portToBind = typeof PORT === 'string' ? parseInt(PORT) : PORT;
  app.listen(portToBind, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  });
}

start().catch(console.error);
