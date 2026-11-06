import { HttpStatus } from '@nestjs/common';
import { AD_IMAGE_MAX_BYTES, type AdImageFormat } from '@space-sports/shared';
import { AppException } from '../common/app.exception.js';

// Erros dos anúncios (RF-ADS, RN-ADS). Códigos estáveis para o /super tratar cada caso.

const error = (status: HttpStatus, code: string, message: string) => () =>
  new AppException({ status, code, message });

export const advertiserNotFound = error(
  HttpStatus.NOT_FOUND,
  'ADVERTISER_NOT_FOUND',
  'Anunciante não encontrado.',
);
export const campaignNotFound = error(
  HttpStatus.NOT_FOUND,
  'AD_CAMPAIGN_NOT_FOUND',
  'Campanha não encontrada.',
);
export const creativeNotFound = error(
  HttpStatus.NOT_FOUND,
  'AD_CREATIVE_NOT_FOUND',
  'Peça não encontrada.',
);
/** RN-ADS-01, decisão 75. */
export const categoryForbidden = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_CATEGORY_FORBIDDEN',
  'Apostas (bets) e bebidas alcoólicas não podem anunciar no Space Sports.',
);
export const advertiserSpaceNotFound = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_SPACE_NOT_FOUND',
  'O espaço não existe ou não está ativo.',
);
export const advertiserSpaceTaken = error(
  HttpStatus.CONFLICT,
  'ADVERTISER_SPACE_TAKEN',
  'Esse espaço já tem um anunciante ativo.',
);
export const cityNotFound = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_CITY_NOT_FOUND',
  'Alguma das cidades não existe.',
);
export const sportNotFound = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_SPORT_NOT_FOUND',
  'Algum dos esportes não existe.',
);
export const invalidPeriod = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_INVALID_PERIOD',
  'O fim da campanha precisa ser depois do início.',
);
export const placementLocked = error(
  HttpStatus.CONFLICT,
  'AD_PLACEMENT_LOCKED',
  'A vaga não muda depois que a campanha tem peças (as imagens são do formato da vaga).',
);
export const invalidStatusTransition = error(
  HttpStatus.CONFLICT,
  'AD_INVALID_STATUS_TRANSITION',
  'Essa mudança de status não é permitida a partir do status atual da campanha.',
);
/** RN-ADS-05: destino `SPACE` só com espaço ativo. */
export const destinationSpaceNotFound = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_DESTINATION_SPACE_NOT_FOUND',
  'O espaço do destino não existe ou não está ativo.',
);
export const imageRequired = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_IMAGE_REQUIRED',
  'A peça precisa de imagem. Só anunciante do tipo Espaço, com destino no próprio espaço, pode publicar sem.',
);
/** Check do banco que escapou da validação (destino ou textos): 422, não 500. */
export const invalidCreative = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_CREATIVE_INVALID',
  'A peça tem dados inválidos (destino ou textos). Confira a URL, o WhatsApp e o tamanho dos textos.',
);
/** A vaga da campanha mudou entre a conferência da imagem e a gravação da peça. */
export const placementChanged = error(
  HttpStatus.CONFLICT,
  'AD_PLACEMENT_CHANGED',
  'A vaga da campanha mudou enquanto a imagem era conferida. Envie a imagem de novo no formato da vaga atual.',
);
export const invalidImageKey = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_IMAGE_KEY_INVALID',
  'A chave da imagem não é de um upload de peça para a vaga desta campanha.',
);
export const imageNotUploaded = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_IMAGE_NOT_UPLOADED',
  'A imagem ainda não foi enviada (ou a URL de upload expirou).',
);
export const imageTooLarge = () =>
  new AppException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: 'AD_IMAGE_TOO_LARGE',
    message: 'A imagem passa de 2 MB.',
    details: { maxBytes: AD_IMAGE_MAX_BYTES },
  });
export const invalidImageFile = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_IMAGE_INVALID',
  'O arquivo não é uma imagem JPEG, PNG ou WebP válida.',
);
export const imageWrongAspect = (size: { width: number; height: number }, format: AdImageFormat) =>
  new AppException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: 'AD_IMAGE_WRONG_ASPECT',
    message: `A imagem precisa ter a proporção ${format.aspectWidth}:${format.aspectHeight} da vaga.`,
    details: { ...size, format },
  });
export const imageTooSmall = (size: { width: number; height: number }, format: AdImageFormat) =>
  new AppException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: 'AD_IMAGE_TOO_SMALL',
    message: `A imagem precisa ter pelo menos ${format.minWidth}×${format.minHeight} pixels.`,
    details: { ...size, format },
  });
export const invalidCreativeOrder = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_INVALID_CREATIVE_ORDER',
  'A nova ordem precisa ter todas as peças da campanha, sem repetir.',
);
export const reportRangeTooLarge = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'AD_REPORT_RANGE_TOO_LARGE',
  'O relatório vai até um ano por consulta.',
);
