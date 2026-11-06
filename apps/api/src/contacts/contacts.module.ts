import { Module } from '@nestjs/common';
import { ContactLinksService } from './contact-links.service.js';
import {
  PublicContactsController,
  SpaceContactsController,
  SuperContactsController,
} from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';
import { PhoneSuggestions } from './phone-suggestions.service.js';
import { RateLimiter } from './rate-limiter.js';

/**
 * Base de contatos (RF-CONTACT-01 a RF-CONTACT-08, decisão 48). As escritas que nascem em reservas
 * e mensalistas usam `contact-store`, sem depender deste módulo; aqui ficam a consulta, a
 * exportação, o descadastro e o vínculo com a conta.
 */
@Module({
  controllers: [SuperContactsController, SpaceContactsController, PublicContactsController],
  providers: [RateLimiter, PhoneSuggestions, ContactLinksService, ContactsService],
  exports: [RateLimiter, PhoneSuggestions, ContactLinksService],
})
export class ContactsModule {}
