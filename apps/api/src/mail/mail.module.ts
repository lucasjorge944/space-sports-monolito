import { Global, Module } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { Mailer, SmtpMailer } from './mailer.js';

@Global()
@Module({
  providers: [{ provide: Mailer, inject: [ENV], useFactory: (env: Env) => new SmtpMailer(env) }],
  exports: [Mailer],
})
export class MailModule {}
