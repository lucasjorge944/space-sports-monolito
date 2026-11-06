import {
  adCampaignDetailSchema,
  adCampaignListSchema,
  adCampaignSchema,
  adCampaignStatusChangeSchema,
  adCreativeListSchema,
  adCreativeSchema,
  adDeliveryListSchema,
  adEventsInputSchema,
  adEventsResultSchema,
  adImageUploadSchema,
  adReportSchema,
  advertiserListSchema,
  advertiserSchema,
  createAdCampaignSchema,
  createAdCreativeSchema,
  createAdImageUploadSchema,
  createAdvertiserSchema,
  reorderAdCreativesSchema,
  updateAdCampaignSchema,
  updateAdCreativeSchema,
  updateAdvertiserSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI dos anúncios, a partir dos schemas de @space-sports/shared.

export const adsSchemas = {
  // Super: anunciantes
  advertiserList: openApiSchema(advertiserListSchema, 'AdvertiserList', 'output'),
  advertiser: openApiSchema(advertiserSchema, 'Advertiser', 'output'),
  createAdvertiser: openApiSchema(createAdvertiserSchema, 'CreateAdvertiserInput', 'input'),
  updateAdvertiser: openApiSchema(updateAdvertiserSchema, 'UpdateAdvertiserInput', 'input'),
  // Super: campanhas
  campaignList: openApiSchema(adCampaignListSchema, 'AdCampaignList', 'output'),
  campaign: openApiSchema(adCampaignSchema, 'AdCampaign', 'output'),
  campaignDetail: openApiSchema(adCampaignDetailSchema, 'AdCampaignDetail', 'output'),
  createCampaign: openApiSchema(createAdCampaignSchema, 'CreateAdCampaignInput', 'input'),
  updateCampaign: openApiSchema(updateAdCampaignSchema, 'UpdateAdCampaignInput', 'input'),
  campaignStatus: openApiSchema(adCampaignStatusChangeSchema, 'AdCampaignStatusInput', 'input'),
  // Super: peças
  creative: openApiSchema(adCreativeSchema, 'AdCreative', 'output'),
  creativeList: openApiSchema(adCreativeListSchema, 'AdCreativeList', 'output'),
  createCreative: openApiSchema(createAdCreativeSchema, 'CreateAdCreativeInput', 'input'),
  updateCreative: openApiSchema(updateAdCreativeSchema, 'UpdateAdCreativeInput', 'input'),
  reorderCreatives: openApiSchema(reorderAdCreativesSchema, 'ReorderAdCreativesInput', 'input'),
  createImageUpload: openApiSchema(createAdImageUploadSchema, 'CreateAdImageUploadInput', 'input'),
  imageUpload: openApiSchema(adImageUploadSchema, 'AdImageUpload', 'output'),
  // Super: relatório
  report: openApiSchema(adReportSchema, 'AdReport', 'output'),
  // Público: entrega e eventos
  deliveryList: openApiSchema(adDeliveryListSchema, 'AdDeliveryList', 'output'),
  events: openApiSchema(adEventsInputSchema, 'AdEventsInput', 'input'),
  eventsResult: openApiSchema(adEventsResultSchema, 'AdEventsResult', 'output'),
};
