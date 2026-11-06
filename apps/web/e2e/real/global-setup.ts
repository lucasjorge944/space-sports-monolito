import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Recria os dados de teste (apaga e recarrega o banco `*_e2e`) antes da suíte. */
export default function globalSetup() {
  execFileSync('pnpm', ['exec', 'tsx', 'test/e2e-seed/seed.ts'], {
    cwd: resolve(__dirname, '../../../api'),
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        'postgres://space_sports:space_sports@localhost:5432/space_sports_e2e',
    },
  });
}
