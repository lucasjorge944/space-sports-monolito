// Endereços e credenciais dos e2e reais. As portas vêm das mesmas variáveis do playwright.real.config.ts.
export const API = `http://localhost:${process.env.E2E_API_PORT ?? 3335}`;
export const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3100}`;
/** Caixa de e-mail do Mailpit (docker compose): é por onde chegam os links de verificação e convite. */
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
/** Senha de todos os usuários do seed de teste (apps/api/test/e2e-seed). */
export const PASSWORD = 'senha-e2e-1234';

export const USERS = {
  owner: 'dono.e2e@exemplo.com',
  northOwner: 'dono.norte.e2e@exemplo.com',
  super: 'super.e2e@exemplo.com',
  teacher: 'professor.e2e@exemplo.com',
  teacher2: 'professor2.e2e@exemplo.com',
  multiTeacher: 'professor.multi.e2e@exemplo.com',
  player: 'jogador.e2e@exemplo.com',
  player2: 'jogador2.e2e@exemplo.com',
  paidStudent: 'aluno.pago.e2e@exemplo.com',
  unpaidStudent: 'aluno.sempago.e2e@exemplo.com',
  lateStudent: 'aluno.atrasado.e2e@exemplo.com',
} as const;
