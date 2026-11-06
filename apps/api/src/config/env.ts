import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/** Variável vazia no .env (`FOO=`) conta como não definida. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** Lista separada por vírgulas (ex.: `http://localhost:3000,spacesports://`). */
const commaList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const bothOrNone = (a: string, b: string) => (env: Record<string, unknown>) => !env[a] === !env[b];

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().positive().default(3333),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /**
     * Liga os jobs agendados e os workers (BullMQ): ocorrências de mensalistas,
     * envio de push e lembretes de reserva. Padrão: ligado fora de `test` (a fila de notificações
     * vira memória e nada sai do processo). Com várias instâncias da API, o Redis garante uma execução
     * por agendamento.
     */
    JOBS_ENABLED: optional(z.stringbool()),

    // E-mail transacional (Mailpit em dev).
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: optional(z.string()),
    SMTP_PASSWORD: optional(z.string()),
    SMTP_FROM: z.string().min(1).default('Space Sports <nao-responda@spacesports.local>'),

    // Better Auth.
    /** Chave de assinatura de cookies/tokens. Gere com `openssl rand -base64 32`. */
    BETTER_AUTH_SECRET: z.string().min(32),
    /** URL pública da API (links dos e-mails e callbacks OAuth). Padrão em dev: localhost:PORT. */
    BETTER_AUTH_URL: optional(z.url({ protocol: /^https?$/ })),
    /** Origens do web (CORS + CSRF) e esquemas do app (deep links), separados por vírgula. */
    TRUSTED_ORIGINS: commaList,
    /** URL pública do web (e-mails de convite, link do convite da reserva e descadastro). Padrão: a primeira origem http(s) de TRUSTED_ORIGINS. */
    WEB_URL: optional(z.url({ protocol: /^https?$/ })),

    // Provedores: cada um só liga com as credenciais definidas.
    GOOGLE_CLIENT_ID: optional(z.string()),
    GOOGLE_CLIENT_SECRET: optional(z.string()),
    APPLE_CLIENT_ID: optional(z.string()),
    /** JWT assinado com a chave .p8 da Apple (expira em até 6 meses). */
    APPLE_CLIENT_SECRET: optional(z.string()),
    /** Bundle id do app iOS, para o login nativo (idToken) com Apple. */
    APPLE_APP_BUNDLE_IDENTIFIER: optional(z.string()),
    /**
     * Login por telefone (OTP, plugin `phoneNumber` do Better Auth). Desligado por padrão em todos
     * os ambientes (decisão 65): só liga com `true` e um SMS_PROVIDER diferente de `none`.
     */
    AUTH_PHONE_LOGIN_ENABLED: z.stringbool().default(false),
    /**
     * Envio do OTP por telefone. `console` loga o código (dev/test); `none` não envia. Padrão:
     * `console` fora de produção e `none` em produção (sem provedor de SMS ainda). Sem
     * AUTH_PHONE_LOGIN_ENABLED=true, nada é enviado.
     */
    SMS_PROVIDER: optional(z.enum(['console', 'none'])),

    // Rate limit das rotas de auth e da busca de CEP (contador no Redis, compartilhado entre instâncias).
    /** Padrão: ligado só em produção. */
    AUTH_RATE_LIMIT_ENABLED: optional(z.stringbool()),
    /** Headers com o IP do cliente, em ordem. Vazio: o padrão do Better Auth (x-forwarded-for). */
    AUTH_IP_ADDRESS_HEADERS: commaList,
    /**
     * IPs/CIDRs dos proxies reversos à frente da API. Com eles, o IP do cliente é o primeiro da
     * direita para a esquerda no x-forwarded-for que não é proxy; sem eles, só um header com um
     * único IP é aceito.
     */
    AUTH_TRUSTED_PROXIES: commaList.pipe(
      z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()])),
    ),

    // Geocodificação do endereço dos espaços (RF-SPACE-01). Sem a chave, o endereço é salvo sem
    // lat/lng (o espaço não aparece na busca por raio até ser geocodificado ou ter o pino ajustado).
    GOOGLE_MAPS_API_KEY: optional(z.string()),

    // Notificações (RF-NOTIF-01, RF-NOTIF-04).
    /** Token de acesso do Expo Push (opcional; exigido só se a "enhanced security" estiver ligada). */
    EXPO_ACCESS_TOKEN: optional(z.string()),
    /** Antecedência do lembrete antes da reserva, em minutos. */
    BOOKING_REMINDER_LEAD_MIN: z.coerce.number().int().min(15).max(1440).default(120),
    /**
     * Pedido de avaliação (RN-REVIEW-02): minutos depois do fim da reserva ou da aula. O job
     * (a cada 5 min) não volta mais de 24 h.
     */
    REVIEW_REQUEST_DELAY_MIN: z.coerce.number().int().min(5).max(1380).default(120),

    // Fotos (espaços e perfil) no Amazon S3 com CloudFront (decisão 72), upload por URL
    // pré-assinada. Sem S3_BUCKET e S3_PUBLIC_URL, o upload responde 503 STORAGE_UNAVAILABLE.
    S3_BUCKET: optional(z.string()),
    /** Base pública das fotos publicadas (domínio do CloudFront), sem barra no fim. */
    S3_PUBLIC_URL: optional(z.url({ protocol: /^https?$/ })),
    /** Padrão: `sa-east-1`. */
    S3_REGION: optional(z.string().min(1)),
    /** Endpoint S3 compatível (MinIO em dev); vazio = AWS. */
    S3_ENDPOINT: optional(z.url({ protocol: /^https?$/ })),
    /** Endereço path-style (`<endpoint>/<bucket>/<chave>`), exigido pelo MinIO. Padrão: falso. */
    S3_FORCE_PATH_STYLE: optional(z.stringbool()),
    /**
     * Chaves de acesso, só para dev (MinIO ou uma conta de teste). Sem elas vale a cadeia padrão do
     * SDK (nenhuma chave no servidor): no staging, o `AWS_CONFIG_FILE` com as credenciais
     * temporárias do papel de mídia (infra/README.md).
     */
    S3_ACCESS_KEY_ID: optional(z.string()),
    S3_SECRET_ACCESS_KEY: optional(z.string()),

    // Anúncios (RF-ADS-07, RN-ADS-04).
    /**
     * Chave HMAC dos tokens de entrega dos anúncios (impressões e cliques). Gere com
     * `openssl rand -base64 32`. Obrigatória em produção; fora dela, sem a variável, a API gera uma
     * chave a cada boot (os tokens entregues antes do reinício deixam de contar).
     */
    ADS_DELIVERY_SECRET: optional(z.string().min(32)),

    /**
     * Onde a build de produção (`NODE_ENV=production`) roda: `production` (padrão) ou `staging`. Só
     * o staging aceita o gateway `fake` com `NODE_ENV=production`.
     */
    DEPLOY_ENV: z.enum(['production', 'staging']).default('production'),

    // Pagamento online (decisões 80 a 96; docs/13-pagamentos-online.md).
    /**
     * Gateway de pagamento. `fake`: simulado (cartões de teste, Pix de mentira, simulador no /super),
     * proibido em produção (permitido no staging, `DEPLOY_ENV=staging`). `none`: pagamento online
     * desligado (todos os espaços em `ON_SITE`, RN-ONPAY-09). Padrão: `fake` fora de
     * `NODE_ENV=production` e `none` nele.
     */
    PAYMENTS_PROVIDER: optional(z.enum(['fake', 'none'])),
    /**
     * Chave AES-256-GCM (32 bytes em base64: `openssl rand -base64 32`) dos dados sensíveis do
     * pagamento online, como o documento completo do cadastro no gateway (decisão 97). Obrigatória
     * com NODE_ENV=production; fora dela, sem a variável, a API gera uma a cada boot (o que foi
     * cifrado antes do reinício deixa de decifrar).
     */
    PAYMENTS_DATA_KEY: optional(
      z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
        message: 'Use 32 bytes em base64 (openssl rand -base64 32).',
      }),
    ),
    /**
     * Chave HMAC dos webhooks do gateway fake (`openssl rand -base64 32`). Sem ela, a API gera uma
     * a cada boot (webhooks assinados antes do reinício deixam de valer).
     */
    PAYMENTS_FAKE_WEBHOOK_SECRET: optional(z.string().min(32)),
    /** Para onde o fake entrega os webhooks. Padrão: a própria API em 127.0.0.1:PORT. */
    PAYMENTS_FAKE_WEBHOOK_URL: optional(z.url({ protocol: /^https?$/ })),
    /** Aprovação automática do cadastro no fake. */
    PAYMENTS_FAKE_APPROVAL_DELAY_MS: z.coerce.number().int().min(0).default(5_000),
    /** Chargeback do cartão de teste 4000 0000 0000 0259 depois da aprovação. */
    PAYMENTS_FAKE_CHARGEBACK_DELAY_MS: z.coerce.number().int().min(0).default(60_000),
    /** Liberação do saldo no fake: Pix D+1 e cartão D+30. */
    PAYMENTS_FAKE_PIX_RELEASE_DAYS: z.coerce.number().int().min(0).max(60).default(1),
    PAYMENTS_FAKE_CARD_RELEASE_DAYS: z.coerce.number().int().min(0).max(60).default(30),
    /** Tarifa simulada do gateway (custo da plataforma): Pix 0,99%; cartão 3,49% + R$ 0,39. */
    PAYMENTS_FAKE_PIX_COST_BPS: z.coerce.number().int().min(0).max(10_000).default(99),
    PAYMENTS_FAKE_CARD_COST_BPS: z.coerce.number().int().min(0).max(10_000).default(349),
    PAYMENTS_FAKE_CARD_COST_FIXED_CENTS: z.coerce.number().int().min(0).default(39),
  })
  .refine(bothOrNone('S3_BUCKET', 'S3_PUBLIC_URL'), {
    message: 'Defina S3_BUCKET e S3_PUBLIC_URL juntos (ou nenhum dos dois).',
    path: ['S3_PUBLIC_URL'],
  })
  .refine(bothOrNone('S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'), {
    message: 'Defina S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY juntos (ou nenhum dos dois).',
    path: ['S3_SECRET_ACCESS_KEY'],
  })
  .refine(bothOrNone('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'), {
    message: 'Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET juntos (ou nenhum dos dois).',
    path: ['GOOGLE_CLIENT_SECRET'],
  })
  .refine(bothOrNone('APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET'), {
    message: 'Defina APPLE_CLIENT_ID e APPLE_CLIENT_SECRET juntos (ou nenhum dos dois).',
    path: ['APPLE_CLIENT_SECRET'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.BETTER_AUTH_URL, {
    message: 'Obrigatória em produção.',
    path: ['BETTER_AUTH_URL'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.ADS_DELIVERY_SECRET, {
    message: 'Obrigatória em produção.',
    path: ['ADS_DELIVERY_SECRET'],
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      env.DEPLOY_ENV === 'staging' ||
      env.PAYMENTS_PROVIDER !== 'fake',
    {
      message: 'O gateway `fake` (simulado) não pode ser usado em produção.',
      path: ['PAYMENTS_PROVIDER'],
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.PAYMENTS_DATA_KEY, {
    message: 'Obrigatória em produção.',
    path: ['PAYMENTS_DATA_KEY'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SMS_PROVIDER !== 'console', {
    message: 'O provedor `console` (OTP no log) não pode ser usado em produção.',
    path: ['SMS_PROVIDER'],
  })
  .transform((env) => ({
    ...env,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`,
    WEB_URL: (
      env.WEB_URL ??
      env.TRUSTED_ORIGINS.find((origin) => /^https?:\/\/[^*]+$/.test(origin)) ??
      'http://localhost:3000'
    ).replace(/\/+$/, ''),
    SMS_PROVIDER: env.SMS_PROVIDER ?? (env.NODE_ENV === 'production' ? 'none' : 'console'),
    AUTH_RATE_LIMIT_ENABLED: env.AUTH_RATE_LIMIT_ENABLED ?? env.NODE_ENV === 'production',
    JOBS_ENABLED: env.JOBS_ENABLED ?? env.NODE_ENV !== 'test',
    S3_REGION: env.S3_REGION ?? 'sa-east-1',
    S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE ?? false,
    ADS_DELIVERY_SECRET: env.ADS_DELIVERY_SECRET ?? randomBytes(32).toString('base64'),
    PAYMENTS_PROVIDER: env.PAYMENTS_PROVIDER ?? (env.NODE_ENV === 'production' ? 'none' : 'fake'),
    PAYMENTS_FAKE_WEBHOOK_SECRET:
      env.PAYMENTS_FAKE_WEBHOOK_SECRET ?? randomBytes(32).toString('base64'),
    PAYMENTS_DATA_KEY: env.PAYMENTS_DATA_KEY ?? randomBytes(32).toString('base64'),
    PAYMENTS_FAKE_WEBHOOK_URL:
      env.PAYMENTS_FAKE_WEBHOOK_URL ?? `http://127.0.0.1:${env.PORT}/v1/webhooks/payments/fake`,
  }));

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  constructor(readonly issues: z.core.$ZodIssue[]) {
    const lines = issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    super(`Variáveis de ambiente inválidas:\n${lines.join('\n')}`);
    this.name = 'InvalidEnvError';
  }
}

/** Valida as variáveis de ambiente. Lança InvalidEnvError para o boot falhar cedo. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) throw new InvalidEnvError(result.error.issues);
  return result.data;
}
