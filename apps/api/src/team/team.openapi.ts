import {
  inviteStaffSchema,
  membershipSchema,
  replaceMemberRolesSchema,
  staffInvitePreviewSchema,
  staffInviteSchema,
  staffSpacesResponseSchema,
  teamMemberSchema,
  teamSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI da equipe, a partir dos schemas de @space-sports/shared.

export const schemas = {
  team: openApiSchema(teamSchema, 'Team', 'output'),
  teamMember: openApiSchema(teamMemberSchema, 'TeamMember', 'output'),
  staffInvite: openApiSchema(staffInviteSchema, 'StaffInvite', 'output'),
  staffInvitePreview: openApiSchema(staffInvitePreviewSchema, 'StaffInvitePreview', 'output'),
  staffSpaces: openApiSchema(staffSpacesResponseSchema, 'StaffSpacesResponse', 'output'),
  membership: openApiSchema(membershipSchema, 'SpaceMembership', 'output'),
  inviteStaff: openApiSchema(inviteStaffSchema, 'InviteStaffInput', 'input'),
  replaceMemberRoles: openApiSchema(replaceMemberRolesSchema, 'ReplaceMemberRolesInput', 'input'),
};
