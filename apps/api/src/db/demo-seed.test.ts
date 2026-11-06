import { BRAZILIAN_PHONE_REGEX } from '@space-sports/shared';
import { describe, expect, it } from 'vitest';
import {
  assertDemoSeedAllowed,
  DEMO_ACCOUNTS,
  DemoSeedInProductionError,
  DemoSeedNotAllowedError,
  demoPhone,
} from './demo-seed.js';

describe('assertDemoSeedAllowed', () => {
  it('libera fora de produção com ALLOW_DEMO_SEED=true', () => {
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: 'development', allowDemoSeed: 'true' }),
    ).not.toThrow();
  });

  it.each([undefined, '', 'false', '1', 'TRUE', ' true'])(
    'recusa sem o valor exato da permissão (%j)',
    (allowDemoSeed) => {
      expect(() => assertDemoSeedAllowed({ nodeEnv: 'development', allowDemoSeed })).toThrow(
        DemoSeedNotAllowedError,
      );
    },
  );

  it('NODE_ENV=production recusa mesmo com a permissão', () => {
    expect(() => assertDemoSeedAllowed({ nodeEnv: 'production', allowDemoSeed: 'true' })).toThrow(
      DemoSeedInProductionError,
    );
  });

  it('sem NODE_ENV, a permissão continua obrigatória', () => {
    expect(() => assertDemoSeedAllowed({ nodeEnv: undefined, allowDemoSeed: undefined })).toThrow(
      DemoSeedNotAllowedError,
    );
  });
});

describe('demoPhone', () => {
  it('telefones brasileiros válidos e distintos para todas as contas de demonstração', () => {
    const phones = DEMO_ACCOUNTS.map((_, index) => demoPhone(index));
    for (const phone of phones) expect(phone).toMatch(BRAZILIAN_PHONE_REGEX);
    expect(new Set(phones).size).toBe(DEMO_ACCOUNTS.length);
  });
});
