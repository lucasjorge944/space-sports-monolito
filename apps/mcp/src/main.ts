import { createServer } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { configureApiClient } from '@space-sports/api-client/dist/fetch.js';
import { loadConfig } from './config.js';
import { createApp, MAX_BODY_BYTES } from './http/app.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
configureApiClient({ baseUrl: config.apiUrl });

const app = createApp({ config, logger });
const handler = toNodeHandler(app, {
  maxRequestBodySize: MAX_BODY_BYTES,
  onerror: (error) => logger.error({ event: 'http_error', name: error.name }),
});
const server = createServer((req, res) => void handler(req, res));

server.listen(config.port, config.host, () => {
  logger.info({ event: 'listening', port: config.port, enabled: config.enabled });
});

let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ event: 'shutdown', signal });
  server.close(() => {
    void app.close().finally(() => process.exit(0));
  });
  // Conexões presas não seguram o encerramento.
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
