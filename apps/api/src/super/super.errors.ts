import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

const error = (status: HttpStatus, code: string, message: string) => () =>
  new AppException({ status, code, message });

export const slugTaken = error(
  HttpStatus.CONFLICT,
  'SLUG_TAKEN',
  'Já existe um espaço com esse endereço (slug).',
);
export const invalidStatusTransition = error(
  HttpStatus.CONFLICT,
  'INVALID_STATUS_TRANSITION',
  'Essa mudança de status não é permitida a partir do status atual do espaço.',
);
export const supportSessionNotFound = error(
  HttpStatus.NOT_FOUND,
  'SUPPORT_SESSION_NOT_FOUND',
  'Sessão de suporte não encontrada.',
);
export const sportNotFound = error(
  HttpStatus.NOT_FOUND,
  'SPORT_NOT_FOUND',
  'Esporte não encontrado.',
);
export const amenityNotFound = error(
  HttpStatus.NOT_FOUND,
  'AMENITY_NOT_FOUND',
  'Item de infraestrutura não encontrado.',
);
export const cityIdNotFound = error(
  HttpStatus.NOT_FOUND,
  'CITY_NOT_FOUND',
  'Cidade não encontrada.',
);
export const catalogSlugTaken = error(
  HttpStatus.CONFLICT,
  'CATALOG_SLUG_TAKEN',
  'Já existe um item do catálogo com esse identificador.',
);
export const cityAlreadyExists = error(
  HttpStatus.CONFLICT,
  'CITY_ALREADY_EXISTS',
  'Essa cidade já está cadastrada.',
);
export const catalogInUse = error(
  HttpStatus.CONFLICT,
  'CATALOG_IN_USE',
  'O item está em uso e não pode ser excluído. No caso de cidades, desative-a.',
);
export const userNotFound = error(
  HttpStatus.NOT_FOUND,
  'USER_NOT_FOUND',
  'Usuário não encontrado.',
);
export const cannotActOnSelf = error(
  HttpStatus.CONFLICT,
  'CANNOT_ACT_ON_SELF',
  'Você não pode fazer isso com a sua própria conta.',
);
export const userDeleted = error(
  HttpStatus.CONFLICT,
  'USER_DELETED',
  'A conta já foi excluída (anonimizada).',
);
export const emailNotVerified = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'EMAIL_NOT_VERIFIED',
  'Só é possível promover uma conta com o e-mail verificado.',
);
export const notSuper = error(
  HttpStatus.CONFLICT,
  'NOT_SUPER',
  'Esse usuário não é da equipe Super.',
);
export const lastSuper = error(
  HttpStatus.CONFLICT,
  'LAST_SUPER',
  'Deve haver ao menos um usuário Super ativo.',
);
export const deletionRequestNotFound = error(
  HttpStatus.NOT_FOUND,
  'DELETION_REQUEST_NOT_FOUND',
  'Pedido de exclusão não encontrado.',
);
export const deletionRequestResolved = error(
  HttpStatus.CONFLICT,
  'DELETION_REQUEST_RESOLVED',
  'Esse pedido de exclusão já foi atendido, recusado ou cancelado.',
);
export const deletionRequestPending = error(
  HttpStatus.CONFLICT,
  'DELETION_REQUEST_PENDING',
  'Já existe um pedido de exclusão pendente para esse usuário.',
);
export const lastOwner = error(
  HttpStatus.CONFLICT,
  'LAST_OWNER',
  'O usuário é o único Dono de um espaço. Defina outro Dono antes de excluir a conta.',
);
export const lastSuperDeletion = error(
  HttpStatus.CONFLICT,
  'LAST_SUPER',
  'O usuário é o único Super ativo. Promova outro antes de excluir a conta.',
);
export const userIsBlocked = error(
  HttpStatus.CONFLICT,
  'USER_IS_BLOCKED',
  'A conta está bloqueada. Desbloqueie antes de promovê-la.',
);
export const userIsInactive = error(
  HttpStatus.CONFLICT,
  'USER_IS_INACTIVE',
  'A conta foi inativada pelo titular. Reative antes de promovê-la.',
);
