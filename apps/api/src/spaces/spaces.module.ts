import { Module } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { createGeocoder, Geocoder } from '../geocoding/geocoder.js';
import { CatalogController } from './catalog.controller.js';
import { CourtsController } from './courts.controller.js';
import { CourtsService } from './courts.service.js';
import { ManageSpacesController } from './manage-spaces.controller.js';
import { ManageSpacesService } from './manage-spaces.service.js';
import { PublicSpacesController } from './public-spaces.controller.js';
import { PublicSpacesService } from './public-spaces.service.js';
import { SpaceLogoService } from './space-logo.service.js';

/** Espaços, quadras, configurações, logo, busca, favoritos e recentes (RF-SPACE-01..04, 08, 09, 11, 12). */
@Module({
  controllers: [
    CatalogController,
    ManageSpacesController,
    CourtsController,
    PublicSpacesController,
  ],
  providers: [
    { provide: Geocoder, inject: [ENV], useFactory: (env: Env) => createGeocoder(env) },
    ManageSpacesService,
    CourtsService,
    PublicSpacesService,
    SpaceLogoService,
  ],
  exports: [ManageSpacesService, PublicSpacesService],
})
export class SpacesModule {}
