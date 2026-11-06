import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

export { invalidCursor, spaceNotFound } from '../spaces/spaces.errors.js';

const error = (status: HttpStatus, code: string, message: string) => () =>
  new AppException({ status, code, message });

export const reviewNotFound = error(
  HttpStatus.NOT_FOUND,
  'REVIEW_NOT_FOUND',
  'Avaliação não encontrada.',
);
/** RN-REVIEW-01: sem reserva ou aula que dê direito a avaliar nos últimos 6 meses. */
export const reviewNotEligible = error(
  HttpStatus.FORBIDDEN,
  'REVIEW_NOT_ELIGIBLE',
  'Só quem jogou ou teve aula no espaço nos últimos 6 meses pode avaliá-lo.',
);
/** RN-REVIEW-01 (decisão 99): a equipe ativa não avalia o próprio espaço. */
export const reviewNotAllowed = error(
  HttpStatus.FORBIDDEN,
  'REVIEW_NOT_ALLOWED',
  'A equipe do espaço não pode avaliá-lo.',
);
/** PUT com `createOnly=true` e a pessoa já avaliou (o card de um toque não sobrescreve). */
export const reviewAlreadyExists = error(
  HttpStatus.CONFLICT,
  'REVIEW_ALREADY_EXISTS',
  'Você já avaliou este espaço.',
);
/** Decisão 100: positivos só com nota 4–5, negativos só com 1–3. */
export const reviewTagsMismatch = error(
  HttpStatus.BAD_REQUEST,
  'REVIEW_TAGS_MISMATCH',
  'Os destaques não combinam com a nota: positivos vão com 4 ou 5 estrelas, negativos com 1 a 3.',
);
export const reviewReportOwn = error(
  HttpStatus.FORBIDDEN,
  'REVIEW_REPORT_OWN',
  'Você não pode denunciar a sua própria avaliação.',
);
export const reviewAlreadyReported = error(
  HttpStatus.CONFLICT,
  'REVIEW_ALREADY_REPORTED',
  'Você já denunciou esta avaliação.',
);
export const reviewReplyNotFound = error(
  HttpStatus.NOT_FOUND,
  'REVIEW_REPLY_NOT_FOUND',
  'Esta avaliação não tem resposta.',
);
export const reviewReportNotFound = error(
  HttpStatus.NOT_FOUND,
  'REVIEW_REPORT_NOT_FOUND',
  'Denúncia não encontrada.',
);
export const reviewReportResolved = error(
  HttpStatus.CONFLICT,
  'REVIEW_REPORT_RESOLVED',
  'Esta denúncia já foi resolvida.',
);
export const reviewNoComment = error(
  HttpStatus.CONFLICT,
  'REVIEW_NO_COMMENT',
  'Esta avaliação não tem comentário.',
);
export const reviewCommentHidden = error(
  HttpStatus.CONFLICT,
  'REVIEW_COMMENT_HIDDEN',
  'O comentário já está oculto.',
);
export const reviewCommentNotHidden = error(
  HttpStatus.CONFLICT,
  'REVIEW_COMMENT_NOT_HIDDEN',
  'O comentário não está oculto.',
);
