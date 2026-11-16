import { type DestinationStream, type Logger as PinoLogger, pino } from 'pino';

export type Logger = PinoLogger;

/**
 * Logs estruturados (JSON) sem token nem dados pessoais: só `sub`, id do cliente, tool, duração e
 * resultado. O `redact` é a rede de segurança caso um campo sensível escape por engano.
 */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: 'space-sports-mcp' },
    redact: {
      paths: ['token', 'authorization', '*.token', '*.authorization', 'headers'],
      remove: true,
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
