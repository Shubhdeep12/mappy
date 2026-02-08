import 'dotenv/config';
import app from './app';
import { config } from './config';

const server = app.listen(config.server.port, config.server.host, () => {
  console.log(JSON.stringify({
    type: 'server_start',
    message: `Server listening on http://${config.server.host}:${config.server.port}`,
    environment: config.env,
    timestamp: new Date().toISOString(),
  }));
});

const shutdown = (type: 'SIGINT' | 'SIGTERM') => {
  console.log(`${type} received, shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('SIGINT', () => shutdown('SIGINT'));
