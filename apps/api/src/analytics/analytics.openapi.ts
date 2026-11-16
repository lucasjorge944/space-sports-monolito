import {
  analyticsColumnSchema,
  analyticsUnitSchema,
  bookingAnalyticsSchema,
  classAnalyticsSchema,
  customerAnalyticsSchema,
  occupancyAnalyticsSchema,
  platformAnalyticsSchema,
  revenueAnalyticsSchema,
  spacesAnalyticsSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI da camada de métricas, a partir dos schemas de @space-sports/shared.

openApiSchema(analyticsUnitSchema, 'AnalyticsUnit', 'output');
openApiSchema(analyticsColumnSchema, 'AnalyticsColumn', 'output');

export const analyticsSchemas = {
  bookings: openApiSchema(bookingAnalyticsSchema, 'BookingAnalytics', 'output'),
  occupancy: openApiSchema(occupancyAnalyticsSchema, 'OccupancyAnalytics', 'output'),
  classes: openApiSchema(classAnalyticsSchema, 'ClassAnalytics', 'output'),
  customers: openApiSchema(customerAnalyticsSchema, 'CustomerAnalytics', 'output'),
  revenue: openApiSchema(revenueAnalyticsSchema, 'RevenueAnalytics', 'output'),
  platform: openApiSchema(platformAnalyticsSchema, 'PlatformAnalytics', 'output'),
  spaces: openApiSchema(spacesAnalyticsSchema, 'SpacesAnalytics', 'output'),
};
