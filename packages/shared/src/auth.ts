import { z } from 'zod';
import { favoriteSportSchema, genderSchema, profileRequiredFieldSchema } from './profile';

/** Papel do usuário na plataforma (RN-AUTH-02: só `SUPER` acessa o painel Super). */
export const PLATFORM_ROLES = ['USER', 'SUPER'] as const;
export const platformRoleSchema = z.enum(PLATFORM_ROLES);
export type PlatformRole = z.infer<typeof platformRoleSchema>;

/**
 * Status da conta. `BLOCKED`: bloqueada pelo Super. `INACTIVE`: inativada pelo próprio titular
 * no app (RF-AUTH-03, decisão 29). As duas não abrem sessão; o Super reativa (volta a `ACTIVE`).
 */
export const USER_STATUSES = ['ACTIVE', 'BLOCKED', 'INACTIVE'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

/** Papéis de gestão em um espaço (RN-AUTH-01). Aluno/jogador não é papel de espaço. */
export const SPACE_ROLES = ['OWNER', 'ADMIN', 'TEACHER'] as const;
export const spaceRoleSchema = z.enum(SPACE_ROLES);
export type SpaceRole = z.infer<typeof spaceRoleSchema>;

export const SPACE_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export const spaceStatusSchema = z.enum(SPACE_STATUSES);
export type SpaceStatus = z.infer<typeof spaceStatusSchema>;

/**
 * Matriz de permissões do painel do espaço (docs/02-requisitos-funcionais.md): ação → papéis
 * que podem executá-la. A API aplica com `@SpacePermission(...)`; web e app usam para esconder
 * o que o papel não pode fazer.
 *
 * Restrições finas ficam na regra de negócio de cada endpoint, não aqui:
 * - `team.manage`: o Admin não convida, remove nem altera o Dono.
 * - `schedule.view`: o Professor só visualiza.
 * - `attendance.manage`: o Professor só nas turmas dele.
 * - `classes.view`: o Professor só lê as turmas e sessões dele.
 */
export const SPACE_PERMISSIONS = {
  /** Editar dados, fotos e infraestrutura do espaço. */
  'space.edit': ['OWNER', 'ADMIN'],
  /** Gerir a equipe (convidar, remover, papéis). */
  'team.manage': ['OWNER', 'ADMIN'],
  /** Gerir quadras, preço e configurações. */
  'settings.manage': ['OWNER', 'ADMIN'],
  /** Ver agenda e reservas. */
  'schedule.view': ['OWNER', 'ADMIN', 'TEACHER'],
  /** Criar reserva de balcão ou mensalista. */
  'booking.create': ['OWNER', 'ADMIN'],
  /** Marcar pagamento recebido. */
  'payment.record': ['OWNER', 'ADMIN'],
  /** Dispensar mensalidade de aula (`WAIVED`): perdoar a cobrança é decisão do Dono/Admin. */
  'charge.waive': ['OWNER', 'ADMIN'],
  /** Gerir planos e turmas. */
  'classes.manage': ['OWNER', 'ADMIN'],
  /** Ver planos, turmas, sessões e professores (o Professor só as turmas/sessões dele). */
  'classes.view': ['OWNER', 'ADMIN', 'TEACHER'],
  /** Matricular e desmatricular aluno. */
  'enrollment.manage': ['OWNER', 'ADMIN'],
  /** Abrir/fechar a lista de presença e marcar presença. */
  'attendance.manage': ['OWNER', 'ADMIN', 'TEACHER'],
  /** Gerir torneios. */
  'tournament.manage': ['OWNER', 'ADMIN'],
  /** Lançar placares. */
  'score.record': ['OWNER', 'ADMIN', 'TEACHER'],
  /** Relatórios financeiros do espaço. */
  'reports.financial': ['OWNER', 'ADMIN'],
  /** Ver e exportar os contatos que passaram pelo espaço. */
  'contact.view': ['OWNER', 'ADMIN'],
  /** Enviar o cadastro do espaço no gateway de pagamento (RF-ONPAY-01): só o Dono. */
  'merchant.manage': ['OWNER'],
  /**
   * Pagamento online (RF-ONPAY-02, 07 a 09): ver o cadastro, modos, carteira, cobranças e
   * chargebacks; mudar os modos, estornar e contestar.
   */
  'payments.online.manage': ['OWNER', 'ADMIN'],
  /** Ver as avaliações do espaço, o resumo e a tendência (RF-REVIEW-06). */
  'review.view': ['OWNER', 'ADMIN', 'TEACHER'],
  /** Responder em público e denunciar avaliações (RN-REVIEW-05, decisão 104). */
  'review.reply': ['OWNER', 'ADMIN'],
} as const satisfies Record<string, readonly [SpaceRole, ...SpaceRole[]]>;

export type SpacePermission = keyof typeof SPACE_PERMISSIONS;

/** O papel (ou algum dos papéis) permite a ação? */
export function canInSpace(roles: readonly SpaceRole[], permission: SpacePermission): boolean {
  const allowed: readonly SpaceRole[] = SPACE_PERMISSIONS[permission];
  return roles.some((role) => allowed.includes(role));
}

/** Vínculo ativo do usuário com um espaço (RN-AUTH-03: papéis diferentes por espaço). */
export const membershipSchema = z.object({
  space: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    status: spaceStatusSchema,
    /** Logo do espaço (RF-SPACE-11); nula = iniciais do nome no seletor do painel. */
    logoUrl: z.string().nullable(),
  }),
  roles: z.array(spaceRoleSchema).min(1),
});
export type Membership = z.infer<typeof membershipSchema>;

/** Resposta de GET /v1/me. */
export const meResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email().nullable(),
  emailVerified: z.boolean(),
  /**
   * E.164 (ex.: +5531999998888). Informado no cadastro sem verificação (decisão 64): só
   * `phoneVerified` (OTP) prova que o número é da pessoa.
   */
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  avatarUrl: z.string().nullable(),
  /** Data civil `YYYY-MM-DD` (decisão 68). */
  birthDate: z.iso.date().nullable(),
  gender: genderSchema.nullable(),
  /** Esportes favoritos, pelo nome do esporte (decisão 69). */
  favoriteSports: z.array(favoriteSportSchema),
  /**
   * `missing`: o que a etapa "completar cadastro" exige antes de liberar o app e o painel
   * (decisão 66). Vazio = cadastro completo.
   */
  profile: z.object({ missing: z.array(profileRequiredFieldSchema) }),
  platformRole: platformRoleSchema,
  /** Só vínculos com status ACTIVE, ordenados pelo nome do espaço. */
  memberships: z.array(membershipSchema),
  access: z.object({
    /** RN-AUTH-02: pode entrar em /super. */
    super: z.boolean(),
    /** RN-AUTH-01/RN-AUTH-04: pode entrar em /painel (web) e no modo gestão (app). */
    management: z.boolean(),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Exclusão de conta por pedido (RF-AUTH-03, decisão 40)

/** Prazo de resposta da equipe ao pedido de exclusão (LGPD): `dueAt` = pedido + 15 dias. */
export const DELETION_REQUEST_RESPONSE_DAYS = 15;

/** Minutos em que a sessão vale como "recente" para pedir a exclusão sem informar a senha. */
export const DELETION_RECENT_SESSION_MINUTES = 10;

const deletionReasonSchema = z.string().trim().min(1).max(500);

/**
 * POST /v1/me/deletion-request. Sem `password`, a sessão precisa ter sido aberta há no máximo
 * `DELETION_RECENT_SESSION_MINUTES` minutos (conta sem senha, como a do login por telefone).
 */
export const requestAccountDeletionSchema = z
  .object({
    password: z.string().min(1).max(128).optional(),
    reason: deletionReasonSchema.optional(),
  })
  .strict();
export type RequestAccountDeletionInput = z.infer<typeof requestAccountDeletionSchema>;

/** Resposta do pedido: a conta já está inativa e a equipe responde até `dueAt`. */
export const accountDeletionReceiptSchema = z.object({
  requestId: z.uuid(),
  requestedAt: z.iso.datetime(),
  dueAt: z.iso.datetime(),
});
export type AccountDeletionReceipt = z.infer<typeof accountDeletionReceiptSchema>;

/** POST /v1/public/deletion-request (página web de exclusão, exigência do Google Play). */
export const publicAccountDeletionSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(128),
    reason: deletionReasonSchema.optional(),
  })
  .strict();
export type PublicAccountDeletionInput = z.infer<typeof publicAccountDeletionSchema>;

/** Resposta genérica: não revela se o e-mail existe nem se a senha confere. */
export const publicAccountDeletionResponseSchema = z.object({ message: z.string() });
export type PublicAccountDeletionResponse = z.infer<typeof publicAccountDeletionResponseSchema>;
