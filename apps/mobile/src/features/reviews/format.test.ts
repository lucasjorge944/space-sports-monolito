import { ApiError } from '@space-sports/api-client';
import {
  editedAfterReply,
  ratingSpoken,
  relativeDate,
  reportErrorOutcome,
  reviewButtonLabel,
  reviewMode,
  seeAllReviewsLabel,
  submitErrorMessage,
  toggleTag,
  visibleTags,
} from './format';
import { endedWithinReviewWindow } from './review-prompt-card';
import { editable, eligibility, readOnly } from './test-fixtures';

const apiError = (status: number, code: string) =>
  new ApiError({ status, code, message: code, details: null });

describe('regras de exibição das avaliações', () => {
  it('link da lista: "Ver a avaliação" com uma só; "Ver todas as N avaliações" com mais', () => {
    expect(seeAllReviewsLabel(1)).toBe('Ver a avaliação');
    expect(seeAllReviewsLabel(2)).toBe('Ver todas as 2 avaliações');
    expect(seeAllReviewsLabel(1234)).toBe('Ver todas as 1.234 avaliações');
  });

  it('data relativa por dia de calendário em São Paulo', () => {
    const now = new Date('2026-11-04T15:00:00.000Z');
    expect(relativeDate('2026-11-04T03:30:00.000Z', now)).toBe('hoje');
    // 02:30 UTC de 03/11 ainda é 02/11 em São Paulo: 2 dias de calendário, não "ontem".
    expect(relativeDate('2026-11-03T02:30:00.000Z', now)).toBe('há 2 dias');
    expect(relativeDate('2026-11-03T15:00:00.000Z', now)).toBe('ontem');
    expect(relativeDate('2026-10-28T15:00:00.000Z', now)).toBe('há 1 semana');
    expect(relativeDate('2026-10-14T15:00:00.000Z', now)).toBe('há 3 semanas');
    expect(relativeDate('2026-10-05T15:00:00.000Z', now)).toBe('há 1 mês');
    expect(relativeDate('2026-05-04T15:00:00.000Z', now)).toBe('há 6 meses');
    expect(relativeDate('2024-11-01T15:00:00.000Z', now)).toBe('há 2 anos');
  });

  it('selo: média com 5 ou mais avaliações; abaixo, "Novo"', () => {
    expect(ratingSpoken({ count: 23, average: 4.8 })).toBe('Nota 4,8 de 5, 23 avaliações');
    expect(ratingSpoken({ count: 1234, average: 4 })).toBe('Nota 4,0 de 5, 1.234 avaliações');
    expect(ratingSpoken({ count: 4, average: null })).toBe('Novo, ainda poucas avaliações');
    expect(ratingSpoken(undefined)).toBe('Novo, ainda poucas avaliações');
  });

  it('modo da tela e botão da página conforme a elegibilidade (RN-REVIEW-01)', () => {
    expect(reviewMode(eligibility())).toBe('create');
    expect(reviewButtonLabel(eligibility())).toBe('Avaliar este espaço');
    expect(reviewMode(editable())).toBe('edit');
    expect(reviewButtonLabel(editable())).toBe('Editar minha avaliação');
    expect(reviewMode(readOnly())).toBe('readOnly');
    expect(reviewButtonLabel(readOnly())).toBe('Ver minha avaliação');
    const staff = eligibility({ canReview: false, reason: 'REVIEW_NOT_ALLOWED' });
    expect(reviewMode(staff)).toBe('blocked');
    expect(reviewButtonLabel(staff)).toBeNull();
    expect(reviewButtonLabel(undefined)).toBeNull();
  });

  it('chips: só os do grupo da nota, lembrando a escolha do outro grupo', () => {
    let picked = toggleTag([], 'GOOD_COURT', 5, 5);
    picked = toggleTag(picked, 'CLEAN', 5, 5);
    expect(visibleTags(5, picked)).toEqual(['GOOD_COURT', 'CLEAN']);
    // Nota 2: os positivos somem da tela e do envio.
    expect(visibleTags(2, picked)).toEqual([]);
    picked = toggleTag(picked, 'DIRTY', 2, 5);
    expect(visibleTags(2, picked)).toEqual(['DIRTY']);
    // De volta a 5: os positivos voltam.
    expect(visibleTags(5, picked)).toEqual(['GOOD_COURT', 'CLEAN']);
    expect(visibleTags(null, picked)).toEqual([]);
  });

  it('chips: no máximo 5 do grupo', () => {
    const five = ['GOOD_COURT', 'GOOD_SERVICE', 'CLEAN', 'GOOD_VALUE', 'EASY_BOOKING'] as const;
    expect(toggleTag([...five], 'ON_TIME', 5, 5)).toEqual([...five]);
    expect(toggleTag([...five], 'CLEAN', 5, 5)).toHaveLength(4);
  });

  it('"editada" só quando mudou depois da resposta', () => {
    const reply = { repliedAt: '2026-10-02T00:00:00.000Z' };
    expect(editedAfterReply({ updatedAt: '2026-10-03T00:00:00.000Z', reply })).toBe(true);
    expect(editedAfterReply({ updatedAt: '2026-10-01T00:00:00.000Z', reply })).toBe(false);
    expect(editedAfterReply({ updatedAt: '2026-10-03T00:00:00.000Z', reply: null })).toBe(false);
  });

  it('mensagens de erro do envio', () => {
    expect(submitErrorMessage(apiError(400, 'REVIEW_TAGS_MISMATCH'))).toBe(
      'Os destaques não combinam com a nota. Confira e envie de novo.',
    );
    expect(submitErrorMessage(apiError(403, 'REVIEW_NOT_ELIGIBLE'))).toMatch(/depois de jogar/);
    expect(submitErrorMessage(apiError(403, 'REVIEW_NOT_ALLOWED'))).toMatch(/equipe/);
    expect(submitErrorMessage(apiError(404, 'SPACE_NOT_FOUND'))).toMatch(/não está recebendo/);
    expect(submitErrorMessage(new TypeError('Network request failed'))).toMatch(/Sem conexão/);
  });

  it('denúncia repetida conta como enviada; a própria, não', () => {
    expect(reportErrorOutcome(apiError(409, 'REVIEW_ALREADY_REPORTED'))).toEqual({
      reported: true,
      message: 'Você já denunciou esta avaliação.',
    });
    expect(reportErrorOutcome(apiError(403, 'REVIEW_REPORT_OWN')).reported).toBe(false);
  });

  it('o convite vale para uso terminado há até 6 meses', () => {
    const now = new Date('2026-11-04T12:00:00.000Z');
    expect(endedWithinReviewWindow('2026-11-04T10:00:00.000Z', now)).toBe(true);
    expect(endedWithinReviewWindow('2026-11-04T13:00:00.000Z', now)).toBe(false);
    expect(endedWithinReviewWindow('2026-05-05T12:00:00.000Z', now)).toBe(true);
    expect(endedWithinReviewWindow('2026-05-03T12:00:00.000Z', now)).toBe(false);
  });
});
