import {
  addEnrollmentSchema,
  approveSubscriptionSchema,
  delinquentsResponseSchema,
  requestSubscriptionSchema,
  spaceSubscriptionChargePageSchema,
  staffSubscriptionChargeSchema,
  staffSubscriptionDetailSchema,
  subscriptionChargeSchema,
  subscriptionChargesResponseSchema,
  subscriptionDetailSchema,
  subscriptionPageSchema,
  subscriptionReasonSchema,
  subscriptionsResponseSchema,
  swapClassGroupSchema,
  updateMySubscriptionSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI das assinaturas e mensalidades, a partir de @space-sports/shared.

export const subscriptionSchemas = {
  detail: openApiSchema(subscriptionDetailSchema, 'SubscriptionDetail', 'output'),
  staffDetail: openApiSchema(staffSubscriptionDetailSchema, 'StaffSubscriptionDetail', 'output'),
  list: openApiSchema(subscriptionsResponseSchema, 'SubscriptionsResponse', 'output'),
  page: openApiSchema(subscriptionPageSchema, 'SubscriptionPage', 'output'),
  charge: openApiSchema(subscriptionChargeSchema, 'SubscriptionCharge', 'output'),
  staffCharge: openApiSchema(staffSubscriptionChargeSchema, 'StaffSubscriptionCharge', 'output'),
  charges: openApiSchema(
    subscriptionChargesResponseSchema,
    'SubscriptionChargesResponse',
    'output',
  ),
  spaceCharges: openApiSchema(
    spaceSubscriptionChargePageSchema,
    'SpaceSubscriptionChargePage',
    'output',
  ),
  delinquents: openApiSchema(delinquentsResponseSchema, 'DelinquentsResponse', 'output'),
  request: openApiSchema(requestSubscriptionSchema, 'RequestSubscriptionInput', 'input'),
  updateMine: openApiSchema(updateMySubscriptionSchema, 'UpdateMySubscriptionInput', 'input'),
  reason: openApiSchema(subscriptionReasonSchema, 'SubscriptionReasonInput', 'input'),
  approve: openApiSchema(approveSubscriptionSchema, 'ApproveSubscriptionInput', 'input'),
  swap: openApiSchema(swapClassGroupSchema, 'SwapClassGroupInput', 'input'),
  addEnrollment: openApiSchema(addEnrollmentSchema, 'AddEnrollmentInput', 'input'),
};
