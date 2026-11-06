import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module.js';
import { AvailabilityService } from './availability.service.js';
import { BookingViews } from './booking-views.js';
import {
  AvailabilityController,
  BookingsController,
  InvitesController,
} from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { CourtBlocksService } from './court-blocks.service.js';
import { InvitesService } from './invites.service.js';
import { PaymentsService } from './payments.service.js';
import { PublicInvitesController } from './public-invites.controller.js';
import { SpaceBookingsController } from './space-bookings.controller.js';
import { SpaceContextService } from './space-context.js';
import { SpaceStatementController } from './space-statement.controller.js';
import { StatementService } from './statement.service.js';

/**
 * Aluguel avulso (RF-BOOK-01..04, 06, 08; RN-BOOK-01..07, 09) e registro de pagamentos das
 * reservas (RF-PAY-01, RF-PAY-03, RN-PAY-01). O mensalista em
 * si (solicitação, aprovação, jobs) fica em `RecurringModule`, que reaproveita os providers
 * exportados aqui.
 */
@Module({
  imports: [ContactsModule],
  controllers: [
    AvailabilityController,
    BookingsController,
    InvitesController,
    PublicInvitesController,
    SpaceBookingsController,
    SpaceStatementController,
  ],
  providers: [
    SpaceContextService,
    BookingViews,
    AvailabilityService,
    BookingsService,
    InvitesService,
    PaymentsService,
    CourtBlocksService,
    StatementService,
  ],
  exports: [SpaceContextService, BookingViews],
})
export class BookingsModule {}
