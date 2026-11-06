import {
  classGroupDetailSchema,
  classGroupSchema,
  classGroupsResponseSchema,
  classSessionConflictsResponseSchema,
  classSessionSchema,
  classSessionsResponseSchema,
  createClassGroupSchema,
  createPlanSchema,
  planSchema,
  plansResponseSchema,
  publicSpaceClassesSchema,
  teachersResponseSchema,
  updateClassGroupSchema,
  updateClassSessionSchema,
  updatePlanSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI das aulas, a partir dos schemas de @space-sports/shared.

export const schemas = {
  teachers: openApiSchema(teachersResponseSchema, 'TeachersResponse', 'output'),
  classGroup: openApiSchema(classGroupSchema, 'ClassGroup', 'output'),
  classGroupDetail: openApiSchema(classGroupDetailSchema, 'ClassGroupDetail', 'output'),
  classGroups: openApiSchema(classGroupsResponseSchema, 'ClassGroupsResponse', 'output'),
  conflicts: openApiSchema(
    classSessionConflictsResponseSchema,
    'ClassSessionConflictsResponse',
    'output',
  ),
  classSession: openApiSchema(classSessionSchema, 'ClassSession', 'output'),
  classSessions: openApiSchema(classSessionsResponseSchema, 'ClassSessionsResponse', 'output'),
  plan: openApiSchema(planSchema, 'Plan', 'output'),
  plans: openApiSchema(plansResponseSchema, 'PlansResponse', 'output'),
  publicClasses: openApiSchema(publicSpaceClassesSchema, 'PublicSpaceClasses', 'output'),
  createClassGroup: openApiSchema(createClassGroupSchema, 'CreateClassGroupInput', 'input'),
  updateClassGroup: openApiSchema(updateClassGroupSchema, 'UpdateClassGroupInput', 'input'),
  updateClassSession: openApiSchema(updateClassSessionSchema, 'UpdateClassSessionInput', 'input'),
  createPlan: openApiSchema(createPlanSchema, 'CreatePlanInput', 'input'),
  updatePlan: openApiSchema(updatePlanSchema, 'UpdatePlanInput', 'input'),
};
