import {
  addAttendeeSchema,
  cancelClassSessionSchema,
  classAttendancesResponseSchema,
  classGroupFrequencySchema,
  classSessionDetailSchema,
  markPresenceSchema,
  myClassSessionDetailSchema,
  myClassSessionsResponseSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI da lista de presença, a partir dos schemas de @space-sports/shared.

export const attendanceSchemas = {
  classSessionDetail: openApiSchema(classSessionDetailSchema, 'ClassSessionDetail', 'output'),
  myClassSessions: openApiSchema(
    myClassSessionsResponseSchema,
    'MyClassSessionsResponse',
    'output',
  ),
  myClassSessionDetail: openApiSchema(myClassSessionDetailSchema, 'MyClassSessionDetail', 'output'),
  classAttendances: openApiSchema(
    classAttendancesResponseSchema,
    'ClassAttendancesResponse',
    'output',
  ),
  classGroupFrequency: openApiSchema(classGroupFrequencySchema, 'ClassGroupFrequency', 'output'),
  cancelClassSession: openApiSchema(cancelClassSessionSchema, 'CancelClassSessionInput', 'input'),
  addAttendee: openApiSchema(addAttendeeSchema, 'AddAttendeeInput', 'input'),
  markPresence: openApiSchema(markPresenceSchema, 'MarkPresenceInput', 'input'),
};
