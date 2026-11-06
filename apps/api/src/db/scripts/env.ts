import { z } from 'zod';

export const scriptEnvSchema = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    SEED_SUPER_EMAIL: z.email().optional(),
    SEED_SUPER_NAME: z.string().trim().min(1).optional(),
    /** Mesmos limites do cadastro (Better Auth): 8 a 128 caracteres. */
    SEED_SUPER_PASSWORD: z.string().min(8).max(128).optional(),
  })
  .refine((env) => !env.SEED_SUPER_EMAIL === !env.SEED_SUPER_NAME, {
    message: 'Defina SEED_SUPER_EMAIL e SEED_SUPER_NAME juntos (ou nenhum dos dois).',
    path: ['SEED_SUPER_NAME'],
  })
  .refine((env) => !env.SEED_SUPER_PASSWORD || env.SEED_SUPER_EMAIL, {
    message: 'SEED_SUPER_PASSWORD exige SEED_SUPER_EMAIL e SEED_SUPER_NAME.',
    path: ['SEED_SUPER_PASSWORD'],
  });

export type ScriptEnv = z.infer<typeof scriptEnvSchema>;

/** Env dos scripts de banco (db:migrate, db:seed). Lança com a lista de problemas. */
export function loadScriptEnv(source: NodeJS.ProcessEnv = process.env): ScriptEnv {
  const result = scriptEnvSchema.safeParse({
    ...source,
    // Variável vazia no .env conta como não definida.
    SEED_SUPER_EMAIL: source.SEED_SUPER_EMAIL || undefined,
    SEED_SUPER_NAME: source.SEED_SUPER_NAME || undefined,
    SEED_SUPER_PASSWORD: source.SEED_SUPER_PASSWORD || undefined,
  });
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Variáveis de ambiente inválidas:\n${lines.join('\n')}`);
  }
  return result.data;
}

/** Env do seed de demonstração (db:seed:demo), além do de `loadScriptEnv`. */
export const demoEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  /** Permissão explícita para rodar o seed; só `true` libera (`assertDemoSeedAllowed`). */
  ALLOW_DEMO_SEED: z.string().optional(),
  /** Senha de todas as contas de demonstração; obrigatória (sem padrão no código). */
  SEED_DEMO_PASSWORD: z.string().min(8).max(128),
  // Storage das fotos (opcional; mesmas variáveis da API): sem ele, as logos dos parceiros são
  // puladas com aviso. Sem S3_ACCESS_KEY_ID, vale a cadeia padrão do SDK, como na API.
  S3_BUCKET: z.string().optional(),
  S3_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
  S3_REGION: z.string().min(1).default('sa-east-1'),
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

export type DemoEnv = z.infer<typeof demoEnvSchema>;

export function loadDemoEnv(source: NodeJS.ProcessEnv = process.env): DemoEnv {
  // Variável vazia no .env conta como não definida.
  const values = Object.fromEntries(
    Object.keys(demoEnvSchema.shape).map((key) => [key, source[key] || undefined]),
  );
  const result = demoEnvSchema.safeParse(values);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Variáveis de ambiente inválidas:\n${lines.join('\n')}`);
  }
  return result.data;
}
