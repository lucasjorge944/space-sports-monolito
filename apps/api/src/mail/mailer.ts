import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Envio de e-mail transacional. Classe abstrata para servir de token de injeção (e de fake nos testes). */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

/** SMTP do .env: Mailpit em dev; em produção, o SMTP do provedor (ex.: Resend). */
export class SmtpMailer extends Mailer {
  private readonly logger = new Logger(SmtpMailer.name);
  private readonly transport: Transporter;

  constructor(private readonly env: Env) {
    super();
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.env.SMTP_FROM, ...message });
    this.logger.debug({ subject: message.subject }, 'E-mail enviado');
  }
}
