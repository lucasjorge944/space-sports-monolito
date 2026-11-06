import { ApiError } from '@space-sports/api-client';
import { describe, expect, it } from 'vitest';
import { apiErrorMessage, isReadOnlyError } from './errors';

const err = (status: number, code: string, details?: unknown) =>
  new ApiError({ status, code, message: 'x', details });

describe('apiErrorMessage', () => {
  it('traduz códigos conhecidos', () => {
    expect(apiErrorMessage(err(409, 'SLOT_UNAVAILABLE'))).toBe(
      'Esse horário já está ocupado nesta quadra.',
    );
  });

  it('traduz os erros da logo do espaço (RF-SPACE-11)', () => {
    expect(apiErrorMessage(err(422, 'LOGO_TOO_LARGE'))).toMatch(/2 MB/);
    expect(apiErrorMessage(err(422, 'LOGO_NOT_UPLOADED'))).toMatch(/não foi concluído/);
    expect(apiErrorMessage(err(422, 'INVALID_LOGO_KEY'))).toMatch(/Escolha o arquivo/);
    expect(apiErrorMessage(err(503, 'STORAGE_UNAVAILABLE'))).toMatch(/armazenamento/);
    expect(apiErrorMessage(err(422, 'INVALID_LOGO_FILE'))).toMatch(/JPEG, PNG ou WebP/);
    expect(apiErrorMessage(err(422, 'INVALID_LOGO_FILE', { width: 800, height: 600 }))).toBe(
      'A logo precisa ser quadrada (mesma largura e altura). A imagem enviada tem 800×600 px.',
    );
  });

  it('traduz os erros do pagamento online', () => {
    expect(apiErrorMessage(err(409, 'ONLINE_CHARGE_ALREADY_PAID'))).toBe(
      'O cliente acabou de pagar pelo app.',
    );
    expect(apiErrorMessage(err(403, 'SUPPORT_MODE_FORBIDDEN'))).toMatch(/modo suporte/);
    expect(
      apiErrorMessage(err(422, 'REFUND_EXCEEDS_BALANCE', { refundableCents: 8000 })).replace(
        /\s/g,
        ' ',
      ),
    ).toBe('O valor passa do que ainda pode ser estornado (R$ 80,00).');
    expect(apiErrorMessage(err(409, 'PAYMENT_IN_PROGRESS'))).toMatch(/em andamento/);
  });

  it('cai no genérico para código desconhecido, sem vazar a mensagem técnica', () => {
    expect(apiErrorMessage(err(400, 'ALGO_NOVO'))).toBe(
      'Não foi possível concluir. Tente novamente.',
    );
    expect(apiErrorMessage(err(502, 'HTTP_ERROR'))).toBe(
      'Erro inesperado. Tente de novo em instantes.',
    );
  });

  it('usa os detalhes da API nos erros de aulas', () => {
    expect(
      apiErrorMessage(
        err(409, 'CLASS_SCHEDULE_CONFLICT', {
          conflictsWith: 'BOOKING',
          startsAt: '2026-11-04T22:00:00.000Z',
        }),
      ),
    ).toBe(
      'O horário conflita com uma reserva em 04/11/2026, 19:00. Escolha outro dia, horário ou quadra.',
    );
    expect(
      apiErrorMessage(err(409, 'CLASS_SCHEDULE_CONFLICT', { conflictsWith: 'CLASS_GROUP' })),
    ).toBe('O horário conflita com outra turma. Escolha outro dia, horário ou quadra.');
    expect(apiErrorMessage(err(409, 'SPORT_CHANGE_NOT_ALLOWED', { enrolledCount: 3 }))).toContain(
      '3 aluno(s)',
    );
    expect(
      apiErrorMessage(err(409, 'SPORT_CHANGE_NOT_ALLOWED', { subscriptionCount: 2 })),
    ).toContain('2 assinatura(s)');
    expect(
      apiErrorMessage(
        err(409, 'COURT_HAS_CLASS_GROUPS', {
          classGroups: [{ id: '1', name: 'Futevôlei Iniciante' }],
        }),
      ),
    ).toContain('Futevôlei Iniciante');
  });

  it('traduz os erros de assinaturas e mensalidades', () => {
    expect(apiErrorMessage(err(409, 'CLASS_GROUP_FULL', { classGroupId: 'x' }))).toBe(
      'A turma não tem mais vagas.',
    );
    expect(apiErrorMessage(err(409, 'CHARGE_HAS_PAYMENTS'))).toContain('Estorne');
    expect(apiErrorMessage(err(409, 'CHARGE_NOT_PAYABLE'))).toContain('dispensada');
    expect(
      apiErrorMessage(err(422, 'CLASS_GROUP_COUNT_MISMATCH', { expected: 2, received: 1 })),
    ).toBe('Este plano exige exatamente 2 turma(s); foram escolhidas 1.');
    expect(apiErrorMessage(err(422, 'CLASS_GROUPS_OVERLAP'))).toContain('mesmo horário');
    expect(apiErrorMessage(err(409, 'INVALID_SUBSCRIPTION_STATUS'))).toContain('estado');
  });

  it('mostra a turma que conflita no horário (decisão 37), de qualquer espaço', () => {
    expect(
      apiErrorMessage(
        err(409, 'CLASS_SCHEDULE_OVERLAP', {
          classGroupId: 'g1',
          conflict: {
            classGroupName: 'Vôlei Misto',
            spaceName: 'Arena B',
            weekday: 2,
            startTime: '19:00',
            durationMin: 60,
            timeZone: 'America/Sao_Paulo',
          },
        }),
      ),
    ).toBe(
      'O aluno já tem a turma Vôlei Misto (Arena B), Terça 19:00 neste horário. Escolha outra turma.',
    );
    expect(apiErrorMessage(err(409, 'CLASS_SCHEDULE_OVERLAP'))).toBe(
      'A turma tem o mesmo horário de outra turma do aluno.',
    );
  });

  it('anexa o fuso ao horário da turma que conflita fora de America/Sao_Paulo', () => {
    expect(
      apiErrorMessage(
        err(409, 'CLASS_SCHEDULE_OVERLAP', {
          conflict: {
            classGroupName: 'Vôlei Misto',
            spaceName: 'Arena Norte',
            weekday: 2,
            startTime: '19:00',
            timeZone: 'America/Manaus',
          },
        }),
      ),
    ).toBe(
      'O aluno já tem a turma Vôlei Misto (Arena Norte), Terça 19:00, horário de Manaus neste horário. Escolha outra turma.',
    );
  });

  it('mostra nome, espaço e horário da aula sobreposta, sem o status do aluno', () => {
    const message = apiErrorMessage(
      err(409, 'CLASS_SESSION_OVERLAP', {
        conflict: {
          classGroupName: 'Vôlei Misto',
          spaceName: 'Arena B',
          startsAt: '2026-11-04T22:00:00.000Z',
          endsAt: '2026-11-04T23:00:00.000Z',
          status: 'CONFIRMED',
        },
      }),
    );
    expect(message).toBe(
      'O aluno já está na lista da aula Vôlei Misto (Arena B) no mesmo horário (04/11/2026, 19:00 às 20:00).',
    );
    expect(message).not.toMatch(/confirmad/i);
    expect(apiErrorMessage(err(409, 'CLASS_SESSION_OVERLAP'))).toBe(
      'O aluno já está na lista de outra aula no mesmo horário.',
    );
  });

  it('explica o conflito de professor com o horário, sem citar o outro espaço (decisão 47)', () => {
    const message = apiErrorMessage(
      err(409, 'TEACHER_SCHEDULE_CONFLICT', {
        teacher: { memberId: 'm1', name: 'Lia Admin' },
        startsAt: '2026-11-03T22:00:00.000Z',
        endsAt: '2026-11-03T23:00:00.000Z',
        timeZone: 'America/Sao_Paulo',
      }),
    );
    expect(message).toContain('Lia Admin já tem aula em outro espaço');
    expect(message).toContain('03/11/2026');
    expect(message).toContain('19:00');
    expect(message).toContain('20:00');
    expect(apiErrorMessage(err(409, 'TEACHER_SCHEDULE_CONFLICT'))).toContain('outro espaço');
  });

  it('diz de quais turmas o professor é o único', () => {
    expect(
      apiErrorMessage(
        err(409, 'TEACHER_HAS_CLASS_GROUPS', {
          classGroups: [{ id: '1', name: 'Terça à noite' }],
          classSessions: [
            { id: '2', classGroup: { name: 'Terça à noite' } },
            { id: '3', classGroup: { name: 'Sábado cedo' } },
          ],
        }),
      ),
    ).toBe(
      'Este é o único professor de: Terça à noite, Sábado cedo. Inclua outro professor nelas ou desative as turmas antes.',
    );
    expect(apiErrorMessage(err(409, 'TEACHER_HAS_CLASS_GROUPS'))).toContain('único professor');
  });

  it('cai na mensagem do código quando os detalhes não vêm', () => {
    expect(apiErrorMessage(err(409, 'COURT_HAS_CLASS_GROUPS'))).toBe(
      'A quadra tem turmas. Mude ou desative as turmas antes.',
    );
    expect(apiErrorMessage(err(409, 'CLASS_SCHEDULE_CONFLICT', { conflictsWith: '???' }))).toBe(
      'O horário da turma conflita com a agenda da quadra.',
    );
  });

  it('reconhece erro de rede e espaço somente leitura', () => {
    expect(apiErrorMessage(new TypeError('fetch failed'))).toContain('Sem conexão');
    expect(isReadOnlyError(err(403, 'SPACE_READ_ONLY'))).toBe(true);
    expect(isReadOnlyError(err(403, 'FORBIDDEN'))).toBe(false);
  });
});
