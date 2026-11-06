import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { OccurrencesService } from './occurrences.service.js';
import { RecurringBookingsController } from './recurring.controller.js';
import { RecurringJobs } from './recurring.jobs.js';
import { RecurringBookingsService } from './recurring-bookings.service.js';
import { RecurringViews } from './recurring-views.js';
import { SpaceRecurringController } from './space-recurring.controller.js';

/**
 * Mensalista (RF-BOOK-05, RF-BOOK-07; RN-BOOK-08): solicitação e gestão do horário fixo semanal,
 * ocorrências e o job que as gera. O mensalista só ocupa a agenda: o pagamento é direto no
 * espaço, sem mensalidade na plataforma (decisão 27).
 */
@Module({
  imports: [BookingsModule],
  controllers: [RecurringBookingsController, SpaceRecurringController],
  providers: [RecurringViews, OccurrencesService, RecurringBookingsService, RecurringJobs],
})
export class RecurringModule {}
