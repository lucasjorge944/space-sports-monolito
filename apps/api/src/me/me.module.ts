import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module.js';
import { AccountService } from './account.service.js';
import { AvatarController } from './avatar.controller.js';
import { AvatarService } from './avatar.service.js';
import { MeController } from './me.controller.js';
import { ProfileService } from './profile.service.js';
import { PublicAccountController } from './public-account.controller.js';
import { StaffSpacesService } from './staff-spaces.service.js';

@Module({
  // RateLimiter (limite dos pedidos de URL de upload da foto).
  imports: [ContactsModule],
  controllers: [MeController, AvatarController, PublicAccountController],
  providers: [StaffSpacesService, AccountService, AvatarService, ProfileService],
})
export class MeModule {}
