import { Module } from '@nestjs/common';
import { StaffInvitesController } from './staff-invites.controller.js';
import { StaffInvitesService } from './staff-invites.service.js';
import { TeamController } from './team.controller.js';
import { TeamService } from './team.service.js';

/** Equipe do espaço: convites por e-mail, papéis múltiplos e remoção (RN-AUTH-01/03/04). */
@Module({
  controllers: [TeamController, StaffInvitesController],
  providers: [TeamService, StaffInvitesService],
  exports: [StaffInvitesService, TeamService],
})
export class TeamModule {}
