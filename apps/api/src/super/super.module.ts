import { Module } from '@nestjs/common';
import { SpacesModule } from '../spaces/spaces.module.js';
import { CatalogService } from './catalog.service.js';
import { FinanceService } from './finance.service.js';
import { InsightsService } from './insights.service.js';
import { DirectOwnerInviter, OwnerInviter } from './owner-inviter.js';
import { SuperCatalogController } from './super-catalog.controller.js';
import { SuperFinanceController } from './super-finance.controller.js';
import { SuperInsightsController } from './super-insights.controller.js';
import { SuperSpacesController } from './super-spaces.controller.js';
import { SuperSpacesService } from './super-spaces.service.js';
import { SuperSupportController } from './super-support.controller.js';
import {
  SuperAdminsController,
  SuperDeletionRequestsController,
  SuperUsersController,
} from './super-users.controller.js';
import { SupportService } from './support.service.js';
import { SuperUsersService } from './users.service.js';

/** Painel Super: espaços, modo suporte, financeiro, catálogos, usuários, métricas e auditoria. */
@Module({
  imports: [SpacesModule],
  controllers: [
    SuperSpacesController,
    SuperSupportController,
    SuperFinanceController,
    SuperCatalogController,
    SuperUsersController,
    SuperDeletionRequestsController,
    SuperAdminsController,
    SuperInsightsController,
  ],
  providers: [
    // A tarefa de equipe (1.4) troca esta implementação pelo convite com token.
    { provide: OwnerInviter, useClass: DirectOwnerInviter },
    SuperSpacesService,
    SupportService,
    FinanceService,
    CatalogService,
    SuperUsersService,
    InsightsService,
  ],
})
export class SuperModule {}
