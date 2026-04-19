import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxService } from './outbox.service';
import {
  DomainEventProcessor,
  OutboxPublisherService,
} from './outbox-publisher.service';
import { DOMAIN_EVENTS_QUEUE, OUTBOX_QUEUE } from './outbox.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent]),
    BullModule.registerQueue({ name: OUTBOX_QUEUE }),
    BullModule.registerQueue({ name: DOMAIN_EVENTS_QUEUE }),
  ],
  providers: [OutboxService, OutboxPublisherService, DomainEventProcessor],
  exports: [OutboxService],
})
export class OutboxModule {}
