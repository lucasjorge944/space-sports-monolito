import { z } from 'zod';
import { staffTodayClassSessionSchema } from './attendance';
import { SPACE_ROLES, spaceRoleSchema, spaceStatusSchema } from './auth';
import { bookingSourceSchema, bookingStatusSchema, localDateSchema } from './booking';

// Equipe do espaço: convites, papéis e remoção de membros (RN-AUTH-01/03/04, RF-NOTIF-02).

/** Validade do convite (RF-NOTIF-02): o link expira, mas pode ser reenviado. */
export const STAFF_INVITE_TTL_DAYS = 7;

/**
 * Papéis que a equipe do espaço pode convidar. O Dono só entra pela plataforma (Super), então
 * não aparece aqui.
 */
export const INVITABLE_ROLES = ['ADMIN', 'TEACHER'] as const;
export const invitableRoleSchema = z.enum(INVITABLE_ROLES);
export type InvitableRole = z.infer<typeof invitableRoleSchema>;

/** Convite em aberto; `EXPIRED` é o convite pendente cujo prazo passou (pode ser reenviado). */
export const STAFF_INVITE_STATUSES = ['PENDING', 'EXPIRED'] as const;
export const staffInviteStatusSchema = z.enum(STAFF_INVITE_STATUSES);
export type StaffInviteStatus = z.infer<typeof staffInviteStatusSchema>;

const isoString = z.iso.datetime();

// ---------------------------------------------------------------------------------------------
// Requisições

/** POST /v1/manage/spaces/:spaceId/team/invites */
export const inviteStaffSchema = z.object({
  email: z.email().max(254),
  role: invitableRoleSchema,
});
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

/** PUT /v1/manage/spaces/:spaceId/team/members/:userId/roles: substitui os papéis do membro. */
export const replaceMemberRolesSchema = z.object({
  roles: z
    .array(spaceRoleSchema)
    .min(1)
    .max(SPACE_ROLES.length)
    .refine((roles) => new Set(roles).size === roles.length, 'Papéis repetidos.'),
});
export type ReplaceMemberRolesInput = z.infer<typeof replaceMemberRolesSchema>;

// ---------------------------------------------------------------------------------------------
// Respostas

export const teamMemberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.email().nullable(),
  avatarUrl: z.string().nullable(),
  /** Papéis ativos do membro neste espaço, na ordem Dono, Admin, Professor. */
  roles: z.array(spaceRoleSchema).min(1),
  /** Quando o primeiro vínculo ativo foi criado. */
  joinedAt: isoString,
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const staffInviteSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: spaceRoleSchema,
  status: staffInviteStatusSchema,
  expiresAt: isoString,
  invitedBy: z.object({ id: z.uuid(), name: z.string() }),
  createdAt: isoString,
});
export type StaffInvite = z.infer<typeof staffInviteSchema>;

/** GET /v1/manage/spaces/:spaceId/team */
export const teamSchema = z.object({
  members: z.array(teamMemberSchema),
  invites: z.array(staffInviteSchema),
});
export type Team = z.infer<typeof teamSchema>;

/**
 * GET /v1/staff-invites/:token: prévia pública do convite (a tela de aceite mostra o espaço e o
 * papel e pré-preenche o e-mail do cadastro). Só quem tem o token, enviado ao e-mail convidado,
 * chega aqui.
 */
export const staffInvitePreviewSchema = z.object({
  email: z.email(),
  role: spaceRoleSchema,
  expiresAt: isoString,
  space: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    status: spaceStatusSchema,
  }),
  /** Já existe uma conta com o e-mail convidado (login em vez de cadastro). */
  hasAccount: z.boolean(),
});
export type StaffInvitePreview = z.infer<typeof staffInvitePreviewSchema>;

// ---------------------------------------------------------------------------------------------
// Visão de equipe no app (RN-AUTH-04): somente leitura

/** Reserva do dia na visão de equipe; sem valores nem telefone do cliente. */
export const staffTodayBookingSchema = z.object({
  id: z.uuid(),
  court: z.object({ id: z.uuid(), name: z.string() }),
  sportName: z.string(),
  startsAt: isoString,
  endsAt: isoString,
  status: bookingStatusSchema,
  source: bookingSourceSchema,
  peopleCount: z.number().int().positive(),
  /** Organizador (conta) ou cliente de balcão; nulo se a conta foi removida. */
  customerName: z.string().nullable(),
});
export type StaffTodayBooking = z.infer<typeof staffTodayBookingSchema>;

/** Espaço onde o usuário tem vínculo ativo, com os papéis dele e a agenda de hoje. */
export const staffSpaceSchema = z.object({
  space: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    status: spaceStatusSchema,
    timeZone: z.string(),
    /** Logo do espaço (RF-SPACE-11); nula = iniciais do nome. */
    logoUrl: z.string().nullable(),
  }),
  roles: z.array(spaceRoleSchema).min(1),
  today: z.object({
    /** Dia local do espaço (`YYYY-MM-DD`, America/Sao_Paulo). */
    date: localDateSchema,
    /** Sem canceladas, por horário de início. */
    bookings: z.array(staffTodayBookingSchema),
    /**
     * Aulas de hoje com a lista (RF-CLASS-07, decisão 21: só leitura), por horário; quem é só
     * Professor vê as dele. Inclui as canceladas (com o status).
     */
    classSessions: z.array(staffTodayClassSessionSchema),
  }),
});
export type StaffSpace = z.infer<typeof staffSpaceSchema>;

/** GET /v1/me/staff-spaces */
export const staffSpacesResponseSchema = z.object({ items: z.array(staffSpaceSchema) });
export type StaffSpacesResponse = z.infer<typeof staffSpacesResponseSchema>;
