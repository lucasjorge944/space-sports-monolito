import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { ClassAttendanceJobs } from './attendance.jobs.js';
import { AttendanceService } from './attendance.service.js';
import { AttendanceReportsService } from './attendance-reports.service.js';
import { ClassGroupsService } from './class-groups.service.js';
import { ClassSessionLifecycleService } from './class-session-lifecycle.service.js';
import { ClassSessionsJobs } from './class-sessions.jobs.js';
import { ClassSessionsService } from './class-sessions.service.js';
import { ManageAttendanceController } from './manage-attendance.controller.js';
import { ManageClassesController } from './manage-classes.controller.js';
import { ManageSubscriptionsController } from './manage-subscriptions.controller.js';
import { MeClassesController } from './me-classes.controller.js';
import { MeSubscriptionsController } from './me-subscriptions.controller.js';
import { PlansService } from './plans.service.js';
import { PublicClassesController } from './public-classes.controller.js';
import { SubscriptionChargesService } from './subscription-charges.service.js';
import { SubscriptionsJobs } from './subscriptions.jobs.js';
import { SubscriptionsService } from './subscriptions.service.js';

/**
 * Aulas (RF-CLASS-01..11): professores, turmas fixas, sessões (e o job que as gera), planos,
 * assinaturas com matrículas e mensalidades (e o job de cobrança) e a lista de presença (job de
 * 1 minuto, confirmação, espera e presença real).
 */
@Module({
  imports: [BookingsModule],
  controllers: [
    ManageClassesController,
    ManageAttendanceController,
    MeClassesController,
    PublicClassesController,
    MeSubscriptionsController,
    ManageSubscriptionsController,
  ],
  providers: [
    ClassGroupsService,
    ClassSessionsService,
    PlansService,
    ClassSessionsJobs,
    SubscriptionsService,
    SubscriptionChargesService,
    SubscriptionsJobs,
    ClassSessionLifecycleService,
    AttendanceService,
    AttendanceReportsService,
    ClassAttendanceJobs,
  ],
  exports: [ClassSessionsService, ClassSessionLifecycleService],
})
export class ClassesModule {}
