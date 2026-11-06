import { Logger } from '@nestjs/common';
import type { Env } from '../config/env.js';

/**
 * Envio do código OTP por SMS/WhatsApp (RF-AUTH-01). O provedor ainda não foi escolhido
 * (Twilio/Zenvia, docs/03): quando for, entra aqui uma implementação nova e um valor novo em
 * SMS_PROVIDER, com as credenciais no env.
 */
export abstract class SmsSender {
  abstract sendOtp(phoneNumber: string, code: string): Promise<void>;
}

/** Só para dev/test: o código vai para o log da API. */
export class ConsoleSmsSender extends SmsSender {
  private readonly logger = new Logger('PhoneOtp');

  async sendOtp(phoneNumber: string, code: string): Promise<void> {
    this.logger.warn(
      `OTP para ${phoneNumber}: ${code} (SMS_PROVIDER=console, não usar em produção)`,
    );
  }
}

/** Sender do SMS_PROVIDER configurado; `null` desliga o login por telefone. */
export function createSmsSender(env: Env): SmsSender | null {
  switch (env.SMS_PROVIDER) {
    case 'console':
      return new ConsoleSmsSender();
    case 'none':
      return null;
  }
}
