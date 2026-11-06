import { HttpStatus } from '@nestjs/common';
import type { SoleTeacherAssignments } from '../classes/class-teachers.js';
import { AppException } from '../common/app.exception.js';

const error = (status: HttpStatus, code: string, message: string) => () =>
  new AppException({ status, code, message });

export const memberNotFound = error(
  HttpStatus.NOT_FOUND,
  'MEMBER_NOT_FOUND',
  'Este usuário não faz parte da equipe do espaço.',
);
export const inviteNotFound = error(
  HttpStatus.NOT_FOUND,
  'STAFF_INVITE_NOT_FOUND',
  'Convite não encontrado.',
);
export const inviteUnavailable = error(
  HttpStatus.CONFLICT,
  'STAFF_INVITE_UNAVAILABLE',
  'Este convite foi aceito ou revogado e não está mais disponível.',
);
export const inviteExpired = error(
  HttpStatus.CONFLICT,
  'STAFF_INVITE_EXPIRED',
  'Este convite expirou. Peça a quem convidou para reenviá-lo.',
);
export const inviteEmailMismatch = error(
  HttpStatus.FORBIDDEN,
  'STAFF_INVITE_EMAIL_MISMATCH',
  'Este convite foi enviado para outro e-mail. Entre com a conta do e-mail convidado.',
);
export const inviteEmailNotVerified = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'EMAIL_NOT_VERIFIED',
  'Confirme o seu e-mail antes de aceitar o convite.',
);
export const inviteResendTooSoon = (retryAfterSec: number) =>
  new AppException({
    status: HttpStatus.TOO_MANY_REQUESTS,
    code: 'STAFF_INVITE_RESEND_TOO_SOON',
    message: 'Este convite acabou de ser enviado. Aguarde um pouco para reenviar.',
    details: { retryAfterSec },
  });
export const invitePending = error(
  HttpStatus.CONFLICT,
  'STAFF_INVITE_PENDING',
  'Já existe um convite em aberto para este e-mail e papel. Reenvie o convite existente.',
);
export const alreadyMember = error(
  HttpStatus.CONFLICT,
  'ALREADY_TEAM_MEMBER',
  'Este usuário já tem esse papel no espaço.',
);
/** Admin tentando convidar, alterar ou remover o Dono (matriz: "exceto Dono"). */
export const ownerProtected = error(
  HttpStatus.FORBIDDEN,
  'OWNER_PROTECTED',
  'Só o Dono pode gerenciar o vínculo de outro Dono.',
);
export const ownerRoleRestricted = error(
  HttpStatus.FORBIDDEN,
  'OWNER_ROLE_RESTRICTED',
  'O papel de Dono só é concedido pela equipe da plataforma.',
);
/** RN-AUTH-01: o espaço nunca pode ficar sem Dono. */
export const lastOwner = error(
  HttpStatus.CONFLICT,
  'LAST_OWNER',
  'O último Dono do espaço não pode ser removido nem perder o papel de Dono.',
);
/**
 * RF-CLASS-01: o professor é o único de turmas ativas ou de aulas por acontecer, que ficariam sem
 * ninguém. As turmas vão na mensagem e, com as aulas, em `details`.
 */
export const teacherHasClassGroups = (sole: SoleTeacherAssignments) => {
  const names = new Set([
    ...sole.classGroups.map((group) => group.name),
    ...sole.classSessions.map((session) => session.classGroup.name),
  ]);
  return new AppException({
    status: HttpStatus.CONFLICT,
    code: 'TEACHER_HAS_CLASS_GROUPS',
    message: `Este professor é o único de turmas ativas ou aulas futuras (${[...names].map((name) => `"${name}"`).join(', ')}). Adicione outro professor ou desative as turmas e cancele as aulas antes de removê-lo.`,
    details: sole,
  });
};
