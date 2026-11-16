import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { BookingAnalyticsService } from './booking-analytics.service.js';
import { ClassAnalyticsService } from './class-analytics.service.js';
import { CustomerAnalyticsService } from './customer-analytics.service.js';
import { ManageAnalyticsController } from './manage-analytics.controller.js';
import { OccupancyAnalyticsService } from './occupancy-analytics.service.js';
import { PlatformAnalyticsService } from './platform-analytics.service.js';
import { RevenueAnalyticsService } from './revenue-analytics.service.js';
import { SuperAnalyticsController } from './super-analytics.controller.js';

/**
 * Camada de métricas (decisão 124; RF-MCP-08; RN-MCP-09; docs/14-mcp.md 8.4): endpoints de
 * leitura parametrizados (período, agrupamento, filtros), sem SQL livre, para o MCP e, depois, o
 * assistente do painel (IA-1).
 */
@Module({
  imports: [BookingsModule],
  controllers: [ManageAnalyticsController, SuperAnalyticsController],
  providers: [
    BookingAnalyticsService,
    OccupancyAnalyticsService,
    ClassAnalyticsService,
    CustomerAnalyticsService,
    RevenueAnalyticsService,
    PlatformAnalyticsService,
  ],
})
export class AnalyticsModule {}
