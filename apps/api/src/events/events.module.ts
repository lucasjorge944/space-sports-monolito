import { Global, Module } from '@nestjs/common';
import { DomainEvents, InProcessDomainEvents } from './domain-events.js';

@Global()
@Module({
  providers: [{ provide: DomainEvents, useClass: InProcessDomainEvents }],
  exports: [DomainEvents],
})
export class EventsModule {}
