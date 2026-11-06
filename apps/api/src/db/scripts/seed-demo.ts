import './load-env.js';
import pg from 'pg';
import { createPhotoStorage } from '../../storage/s3-photo-storage.js';
import { createDatabase } from '../client.js';
import {
  assertDemoSeedAllowed,
  DEMO_ACCOUNTS,
  DEMO_PAYMENTS_SPACE,
  DemoAccountConflictError,
  DemoSeedInProductionError,
  DemoSeedNotAllowedError,
  demoEmail,
  seedDemo,
} from '../demo-seed.js';
import { SeedSuperUserConflictError } from '../seed.js';
import { type DemoEnv, loadDemoEnv, loadScriptEnv, type ScriptEnv } from './env.js';

// Seed de demonstração (dev/staging): seed de produção + contas da equipe dos parceiros, fotos
// ilustrativas, logos, uma turma com dois professores e anúncios de anunciantes fictícios.
// Nunca em produção. Uso: ALLOW_DEMO_SEED=true SEED_DEMO_PASSWORD=... pnpm db:seed:demo

try {
  assertDemoSeedAllowed({
    nodeEnv: process.env.NODE_ENV,
    allowDemoSeed: process.env.ALLOW_DEMO_SEED,
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

let env: ScriptEnv;
let demoEnv: DemoEnv;
try {
  env = loadScriptEnv();
  demoEnv = loadDemoEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const storage = createPhotoStorage(demoEnv);
if (!storage.enabled) {
  console.warn(
    'Storage não configurado (S3_BUCKET e S3_PUBLIC_URL): as logos dos parceiros e as imagens dos anúncios não serão enviadas.',
  );
}

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
try {
  const superUser =
    env.SEED_SUPER_EMAIL && env.SEED_SUPER_NAME
      ? {
          email: env.SEED_SUPER_EMAIL,
          name: env.SEED_SUPER_NAME,
          password: env.SEED_SUPER_PASSWORD,
        }
      : undefined;
  const report = await seedDemo(createDatabase(pool), {
    password: demoEnv.SEED_DEMO_PASSWORD,
    nodeEnv: demoEnv.NODE_ENV,
    allowDemoSeed: demoEnv.ALLOW_DEMO_SEED,
    storage,
    seedOptions: { superUser },
    paymentsProvider:
      process.env.PAYMENTS_PROVIDER || (process.env.NODE_ENV === 'production' ? 'none' : 'fake'),
  });
  console.log('Seed de demonstração aplicado. Contas (senha: SEED_DEMO_PASSWORD):');
  for (const account of DEMO_ACCOUNTS) {
    const email = demoEmail(account);
    const created = report.accounts.find((a) => a.email === email)?.created;
    console.log(
      `  ${email.padEnd(30)} ${account.role.padEnd(8)} ${account.space}${created ? ' (nova)' : ''}`,
    );
  }
  for (const [slug, status] of Object.entries(report.photos)) {
    const label = { added: 'ilustrativas gravadas', kept: 'já existiam (mantidas)' }[status];
    console.log(`  fotos ${slug}: ${label}`);
  }
  for (const [slug, status] of Object.entries(report.logos)) {
    const label = { uploaded: 'enviada', kept: 'já existia', skipped: 'pulada (sem storage)' }[
      status
    ];
    console.log(`  logo ${slug}: ${label}`);
  }
  console.log(`  turma com dois professores: ${report.classGroup}`);
  const creativeLabel = {
    uploaded: 'peça enviada',
    created: 'peça sem imagem criada',
    kept: 'peça já existia',
    skipped: 'peça pulada (sem storage)',
  };
  const paymentsLabel = {
    created: 'cadastro aprovado, modos ativos e cobranças de demonstração criados',
    kept: 'já existia (mantido)',
    skipped: 'pulado (sem o gateway fake)',
  }[report.payments];
  console.log(`  pagamento online (${DEMO_PAYMENTS_SPACE.slug}): ${paymentsLabel}`);
  for (const [advertiser, { campaign, creative }] of Object.entries(report.ads)) {
    const campaignLabel = campaign === 'created' ? 'campanha criada' : 'campanha já existia';
    console.log(`  anúncio ${advertiser}: ${campaignLabel}, ${creativeLabel[creative]}`);
  }
} catch (err) {
  const known =
    err instanceof SeedSuperUserConflictError ||
    err instanceof DemoAccountConflictError ||
    err instanceof DemoSeedInProductionError ||
    err instanceof DemoSeedNotAllowedError;
  console.error(known ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
