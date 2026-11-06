import { Module } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { SpacesModule } from '../spaces/spaces.module.js';
import { AdCandidatesCache } from './ad-candidates.cache.js';
import { AdsJobs } from './ads.jobs.js';
import { AdvertisersService } from './advertisers.service.js';
import { AdCampaignsService } from './campaigns.service.js';
import { AdCreativesService } from './creatives.service.js';
import { AdDeliveryService } from './delivery.service.js';
import { DeliveryTokens } from './delivery-token.js';
import { AdEventsService } from './events.service.js';
import { PublicAdsController } from './public-ads.controller.js';
import { AdReportService } from './report.service.js';
import { SuperAdsController } from './super-ads.controller.js';

/**
 * Anúncios (decisões 73 a 79; RF-ADS, RN-ADS; docs/12-anuncios.md): cadastro e relatório no Super,
 * entrega e métricas públicas para o app, e a limpeza diária dos recibos dos eventos.
 */
@Module({
  // RateLimiter (eventos) e PublicSpacesService (card do espaço no destino).
  imports: [ContactsModule, SpacesModule],
  controllers: [SuperAdsController, PublicAdsController],
  providers: [
    {
      provide: DeliveryTokens,
      inject: [ENV],
      useFactory: (env: Env) => new DeliveryTokens(env.ADS_DELIVERY_SECRET),
    },
    AdCandidatesCache,
    AdvertisersService,
    AdCampaignsService,
    AdCreativesService,
    AdReportService,
    AdDeliveryService,
    AdEventsService,
    AdsJobs,
  ],
})
export class AdsModule {}
