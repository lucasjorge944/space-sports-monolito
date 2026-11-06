import type { PlayerBookingDetailDto, PlayerBookingParticipantDto } from '@space-sports/api-client';
import { normalizePhone } from '@space-sports/shared';
import { normalizeEmailInput, validateEmail } from '@/features/auth/validation';
import { INVITE_STATUS_LABELS } from './labels';

/** Convites que ocupam vaga: aguardando ou aceitos (o organizador não conta). */
export function activeInviteCount(participants: PlayerBookingParticipantDto[]): number {
  return participants.filter((p) => !p.isOrganizer && p.status !== 'DECLINED').length;
}

/** Quantos convites ainda cabem: no máximo `peopleCount − 1` ativos (RN-BOOK-09). */
export function remainingInvites(
  peopleCount: number,
  participants: PlayerBookingParticipantDto[],
): number {
  return Math.max(peopleCount - 1 - activeInviteCount(participants), 0);
}

/** O WhatsApp é opcional: vazio passa, e o que foi digitado precisa ser um número completo. */
export function validateInvitePhone(value: string): string | null {
  return value.trim() === '' || normalizePhone(value) ? null : 'Confira o WhatsApp, com DDD';
}

/** O e-mail é opcional: vazio passa. */
export function validateInviteEmail(value: string): string | null {
  return value.trim() === '' ? null : validateEmail(value);
}

/** Item do POST de convites: nome com WhatsApp (E.164) ou e-mail, só com o que foi preenchido. */
export function inviteItem(name: string, phone: string, email: string) {
  const e164 = normalizePhone(phone);
  const address = normalizeEmailInput(email);
  return {
    name: name.trim().replace(/\s+/g, ' '),
    ...(e164 ? { phone: e164 } : {}),
    ...(address ? { email: address } : {}),
  };
}

/** O convite que a API acabou de criar: quem está na resposta e não estava antes. */
export function findNewInvite(
  before: PlayerBookingParticipantDto[],
  after: PlayerBookingParticipantDto[],
): PlayerBookingParticipantDto | undefined {
  const known = new Set(before.map((p) => p.id));
  return after.find((p) => !known.has(p.id) && p.inviteUrl);
}

/** A página do convite é pública: quem recebe responde sem conta e sem o app. */
export function inviteMessage(spaceName: string, when: string, url: string): string {
  return `Bora jogar! Te convidei para ${spaceName} (${when}). Confirme sua presença: ${url}`;
}

/** Abre a conversa com o convidado já com a mensagem. `phone` em E.164. */
export function inviteWhatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

/** Nome na lista: vaga aberta não tem nome até a pessoa preencher a página pública. */
export function guestName(participant: PlayerBookingParticipantDto): string {
  if (participant.isMe) return 'Você';
  return participant.name ?? (participant.status === 'INVITED' ? 'Vaga aberta' : 'Convidado');
}

/** Situação do convidado para o organizador: quem confirmou pode estar sem conta (RF-CONTACT-02). */
export function guestStatus(participant: PlayerBookingParticipantDto) {
  if (participant.status === 'ACCEPTED') {
    const label = participant.hasAccount ? 'No app' : 'Confirmado sem conta';
    return { label, variant: 'success' } as const;
  }
  if (participant.status === 'INVITED' && !participant.name) {
    return { label: 'Aguardando', variant: 'warning' } as const;
  }
  return INVITE_STATUS_LABELS[participant.status];
}

/** Quem reservou (e só ele convida e cancela) é o `organizer.userId` da reserva. */
export function isBookingOrganizer(
  booking: Pick<PlayerBookingDetailDto, 'organizer'>,
  meId: string,
): boolean {
  return booking.organizer.userId === meId;
}
