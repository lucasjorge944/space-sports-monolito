import { HttpStatus, Logger } from '@nestjs/common';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AppException } from './app.exception.js';

const logger = new Logger('JsonBody');
const parseJson = express.json();
/**
 * Os webhooks de pagamento (RN-ONPAY-07) precisam dos bytes exatos para conferir a assinatura, em
 * qualquer content-type: nessas rotas o corpo não é interpretado e fica em `req.rawBody`.
 */
const parseRaw = express.raw({ type: () => true, limit: '1mb' });
const WEBHOOKS = '/v1/webhooks/';

/**
 * express.json() que troca o erro de JSON malformado por 400 INVALID_JSON. O adapter do Nest
 * transformaria o SyntaxError em BadRequestException com a mensagem crua do parser, que cita
 * trechos do corpo; essa mensagem fica só no log.
 */
export function jsonBody(req: Request, res: Response, next: NextFunction): void {
  if (req.originalUrl.startsWith(WEBHOOKS)) {
    parseRaw(req, res, (err?: unknown) => {
      if (!err && Buffer.isBuffer(req.body)) {
        (req as Request & { rawBody?: Buffer }).rawBody = req.body;
      }
      next(err);
    });
    return;
  }
  parseJson(req, res, (err?: unknown) => {
    if ((err as { type?: unknown } | undefined)?.type !== 'entity.parse.failed') return next(err);
    logger.warn({ err }, 'Corpo JSON inválido');
    next(
      new AppException({
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_JSON',
        message: 'JSON inválido.',
      }),
    );
  });
}
