import type { SpaceRole } from '@space-sports/shared';
import { renderEmail } from '../auth/auth-emails.js';
import type { MailMessage } from '../mail/mailer.js';

const ROLE_LABELS: Record<SpaceRole, string> = {
  OWNER: 'Dono',
  ADMIN: 'Administrador',
  TEACHER: 'Professor',
};

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
  timeZone: 'America/Sao_Paulo',
});

export interface StaffInviteEmailInput {
  to: string;
  spaceName: string;
  role: SpaceRole;
  inviterName: string;
  url: string;
  expiresAt: Date;
}

/** E-mail de convite para a equipe de um espaço (RF-NOTIF-02). */
export function staffInviteEmail({
  to,
  spaceName,
  role,
  inviterName,
  url,
  expiresAt,
}: StaffInviteEmailInput): MailMessage {
  const inviter = inviterName.trim() || 'A gestão do espaço';
  return renderEmail(to, `Convite para a equipe de ${spaceName}`, '', {
    intro: `${inviter} convidou você para a equipe de ${spaceName} no Space Sports, como ${ROLE_LABELS[role]}.`,
    action: 'Aceitar convite',
    url,
    outro: `O convite vale até ${dateFormat.format(expiresAt)}. Entre ou crie sua conta com este e-mail para aceitar. Se você não esperava este convite, ignore esta mensagem.`,
  });
}
