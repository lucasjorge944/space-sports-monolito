import type { PlayerBookingParticipantDto } from '@space-sports/api-client';
import {
  activeInviteCount,
  findNewInvite,
  guestName,
  guestStatus,
  inviteItem,
  inviteMessage,
  inviteWhatsappUrl,
  remainingInvites,
  validateInviteEmail,
  validateInvitePhone,
} from './invites';

const p = (over: Partial<PlayerBookingParticipantDto>): PlayerBookingParticipantDto => ({
  id: 'x',
  name: 'Ana',
  isOrganizer: false,
  isMe: false,
  shareCents: 0,
  status: 'INVITED',
  inviteToken: null,
  inviteUrl: null,
  suggestedUser: null,
  hasAccount: false,
  ...over,
});

describe('convites', () => {
  const participants = [
    p({ isOrganizer: true, status: 'ACCEPTED' }),
    p({ status: 'INVITED' }),
    p({ status: 'ACCEPTED' }),
    p({ status: 'DECLINED' }),
  ];

  it('conta só convites ativos, sem organizador nem recusados', () => {
    expect(activeInviteCount(participants)).toBe(2);
  });

  it('restam people_count − 1 − ativos convites', () => {
    expect(remainingInvites(5, participants)).toBe(2);
    expect(remainingInvites(3, participants)).toBe(0);
    expect(remainingInvites(2, participants)).toBe(0);
  });

  it('WhatsApp e e-mail são opcionais, mas o que foi digitado precisa valer', () => {
    expect(validateInvitePhone('')).toBeNull();
    expect(validateInvitePhone('(31) 99999-8888')).toBeNull();
    expect(validateInvitePhone('(31) 9999')).toMatch(/DDD/);
    expect(validateInviteEmail('')).toBeNull();
    expect(validateInviteEmail('ana@exemplo.com')).toBeNull();
    expect(validateInviteEmail('ana')).not.toBeNull();
  });

  it('o item leva só o que foi preenchido, com telefone em E.164 e e-mail normalizado', () => {
    expect(inviteItem('  Ana  Souza ', '', '')).toEqual({ name: 'Ana Souza' });
    expect(inviteItem('Ana', '(31) 99999-8888', ' ANA@Exemplo.com ')).toEqual({
      name: 'Ana',
      phone: '+5531999998888',
      email: 'ana@exemplo.com',
    });
  });

  it('acha o convite recém-criado na resposta da API', () => {
    const before = [p({ id: 'a', inviteUrl: 'https://x/r/a' })];
    const created = p({ id: 'b', inviteUrl: 'https://x/r/b' });
    expect(findNewInvite(before, [...before, created])).toBe(created);
    expect(findNewInvite(before, before)).toBeUndefined();
  });

  it('a mensagem leva o link da página pública, sem exigir o app', () => {
    const message = inviteMessage('Arena', 'Seg 10:00', 'https://app.exemplo/r/abc');
    expect(message).toContain('https://app.exemplo/r/abc');
    expect(message).not.toContain('pelo app');
  });

  it('wa.me abre na conversa, com a mensagem codificada', () => {
    const url = new URL(inviteWhatsappUrl('+5531999998888', 'Bora? https://x/r/a&b=1'));
    expect(url.origin + url.pathname).toBe('https://wa.me/5531999998888');
    expect(url.searchParams.get('text')).toBe('Bora? https://x/r/a&b=1');
  });

  it('número de outro país não ganha o DDI do Brasil', () => {
    expect(inviteWhatsappUrl('+12025550123', 'oi')).toContain('wa.me/12025550123?');
  });

  it('vaga aberta aparece como vaga até a pessoa preencher', () => {
    expect(guestName(p({ name: null }))).toBe('Vaga aberta');
    expect(guestName(p({ name: 'Ana' }))).toBe('Ana');
    expect(guestName(p({ isMe: true }))).toBe('Você');
    expect(guestStatus(p({ name: null })).label).toBe('Aguardando');
  });

  it('quem confirmou aparece sem conta ou no app, com ou sem sugestão de vínculo', () => {
    const suggestedUser = { id: 'u2', firstName: 'Ana' };
    expect(guestStatus(p({ status: 'ACCEPTED', suggestedUser })).label).toBe(
      'Confirmado sem conta',
    );
    expect(guestStatus(p({ status: 'ACCEPTED' })).label).toBe('Confirmado sem conta');
    expect(guestStatus(p({ status: 'ACCEPTED', hasAccount: true })).label).toBe('No app');
    expect(guestStatus(p({ status: 'INVITED', suggestedUser })).label).toBe('Convidado');
  });
});
