import { DEFAULT_TIME_ZONE, DELETION_REQUEST_RESPONSE_DAYS } from '@space-sports/shared';
import { renderEmail } from '../auth/auth-emails.js';
import type { MailMessage } from '../mail/mailer.js';

type Recipient = { to: string; name: string };

const longDate = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DEFAULT_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const SUPPORT_HINT =
  'Para desistir enquanto o pedido estiver em análise, responda a este e-mail ou fale com o atendimento do Space Sports: a equipe cancela o pedido e reativa a sua conta.';

/** Pedido recebido (decisão 40): a conta já está inativa e a equipe responde até o prazo. */
export function deletionRequestedEmail({
  to,
  name,
  dueAt,
}: Recipient & { dueAt: Date }): MailMessage {
  return renderEmail(to, 'Recebemos o seu pedido de exclusão de conta', name, {
    intro: `Recebemos o pedido de exclusão da sua conta no Space Sports. A conta foi inativada e a equipe vai analisar o pedido em até ${DELETION_REQUEST_RESPONSE_DAYS} dias, até ${longDate.format(dueAt)}. Ao concluir, cancelamos as suas reservas, horários de mensalista, assinaturas e confirmações de aula futuras e apagamos os seus dados pessoais; os pagamentos ficam no histórico dos espaços, sem os seus dados.`,
    outro: SUPPORT_HINT,
  });
}

/** Exclusão concluída: os dados pessoais foram apagados. */
export function deletionCompletedEmail({ to, name }: Recipient): MailMessage {
  return renderEmail(to, 'Sua conta foi excluída', name, {
    intro:
      'Concluímos a exclusão da sua conta no Space Sports: os seus dados pessoais foram apagados e as reservas, mensalistas, assinaturas e confirmações de aula futuras foram canceladas. Os pagamentos já feitos ficam no histórico dos espaços, sem os seus dados.',
    outro:
      'Este é o último e-mail que você recebe de nós. Se quiser voltar, é só criar uma conta nova.',
  });
}

/** Pedido recusado (fraude ou exigência legal): a conta não é reativada. */
export function deletionRejectedEmail({
  to,
  name,
  note,
  inactive,
}: Recipient & { note: string; inactive: boolean }): MailMessage {
  return renderEmail(to, 'Seu pedido de exclusão de conta foi recusado', name, {
    intro: `A equipe do Space Sports analisou o pedido de exclusão da sua conta e não pôde atendê-lo. Motivo: ${note}`,
    outro: `${inactive ? 'A conta continua inativa. ' : ''}Se tiver dúvidas, responda a este e-mail ou fale com o atendimento do Space Sports.`,
  });
}

/** Pedido pela página web com a senha certa, mas não registrado (único Dono, conta Super…). */
export function deletionNotOpenedEmail({
  to,
  name,
  reason,
}: Recipient & { reason: string }): MailMessage {
  return renderEmail(to, 'Não foi possível registrar o seu pedido de exclusão', name, {
    intro: `Recebemos um pedido de exclusão da sua conta pela página do Space Sports, mas ele não foi registrado: ${reason}`,
    outro:
      'Se não foi você, recomendamos trocar a senha. Em caso de dúvida, responda a este e-mail ou fale com o atendimento do Space Sports.',
  });
}
