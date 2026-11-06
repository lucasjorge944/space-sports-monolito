import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Env } from './env.js';

export const ENV = Symbol('ENV');

@Global()
@Module({})
export class EnvModule {
  static register(env: Env): DynamicModule {
    return { module: EnvModule, providers: [{ provide: ENV, useValue: env }], exports: [ENV] };
  }
}
