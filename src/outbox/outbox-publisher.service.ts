import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Job, Queue } from 'bull';
import { OutboxService } from './outbox.service';
import {
  DOMAIN_EVENTS_QUEUE,
  DOMAIN_EVENT_JOB,
  OUTBOX_FLUSH_JOB,
  OUTBOX_QUEUE,
} from './outbox.constants';
import type { DomainEventJobPayload } from './outbox.types';

/**
 * OutboxPublisherService — two responsibilities:
 *
 * 1. SCHEDULER (OnModuleInit): registers a repeating Bull job on the
 *    OUTBOX_QUEUE that triggers `flush()` every 5 seconds.  A repeating job
 *    survives restarts because Bull persists it in Redis.
 *
 * 2. FLUSH PROCESSOR (@Process): handles the repeating flush job by
 *    delegating to OutboxService.flush(), which moves PENDING events
 *    onto the domain-events queue.
 *
 * 3. DOMAIN-EVENT PROCESSOR: handles DomainEventJobPayload jobs from
 *    the domain-events queue.  Currently logs the event; replace the
 *    body with real downstream dispatch (WebSocket gateway, push
 *    notifications, analytics, etc.) as needed.
 */
@Injectable()
@Processor(OUTBOX_QUEUE)
export class OutboxPublisherService implements OnModuleInit {
  private readonly logger = new Logger(OutboxPublisherService.name);

  /** Flush interval in milliseconds. */
  private static readonly FLUSH_INTERVAL_MS = 5_000;

  /** Nightly prune: retain published events for this many days. */
  private static readonly PRUNE_RETAIN_DAYS = 30;

  constructor(
    private readonly outboxService: OutboxService,
    @InjectQueue(OUTBOX_QUEUE)
    private readonly outboxQueue: Queue,
    @InjectQueue(DOMAIN_EVENTS_QUEUE)
    private readonly domainEventsQueue: Queue<DomainEventJobPayload>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Remove stale repeatable jobs before re-registering to avoid duplicates.
    const existing = await this.outboxQueue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === OUTBOX_FLUSH_JOB) {
        await this.outboxQueue.removeRepeatableByKey(job.key);
      }
    }

    await this.outboxQueue.add(
      OUTBOX_FLUSH_JOB,
      {},
      {
        repeat: { every: OutboxPublisherService.FLUSH_INTERVAL_MS },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // Register a daily prune job (runs at 02:00 UTC).
    const pruneExisting = await this.outboxQueue.getRepeatableJobs();
    const hasPrune = pruneExisting.some((j) => j.name === 'prune');
    if (!hasPrune) {
      await this.outboxQueue.add(
        'prune',
        {},
        {
          repeat: { cron: '0 2 * * *' },
          removeOnComplete: true,
        },
      );
    }

    this.logger.log(
      `Outbox scheduler started — flush every ${OutboxPublisherService.FLUSH_INTERVAL_MS / 1000}s`,
    );
  }

  /** Triggered by the repeating flush job. */
  @Process(OUTBOX_FLUSH_JOB)
  async handleFlush(_job: Job<Record<string, never>>): Promise<void> {
    await this.outboxService.flush();
  }

  /** Nightly prune of old PUBLISHED events. */
  @Process('prune')
  async handlePrune(_job: Job<Record<string, never>>): Promise<void> {
    const deleted = await this.outboxService.prunePublished(
      OutboxPublisherService.PRUNE_RETAIN_DAYS,
    );
    if (deleted > 0) {
      this.logger.log(`Outbox prune: removed ${deleted} published events`);
    }
  }
}

/**
 * Separate processor class for the domain-events queue.
 *
 * Intentionally kept thin — downstream consumers (notifications,
 * WebSocket gateway, analytics) should subscribe to this queue
 * independently via their own @Processor('domain-events') classes.
 */
@Injectable()
@Processor(DOMAIN_EVENTS_QUEUE)
export class DomainEventProcessor {
  private readonly logger = new Logger(DomainEventProcessor.name);

  @Process(DOMAIN_EVENT_JOB)
  async handle(job: Job<DomainEventJobPayload>): Promise<void> {
    const { eventId, eventType, aggregateType, aggregateId } = job.data;
    this.logger.debug(
      `[domain-event] ${eventType} | ${aggregateType}:${aggregateId} | id=${eventId}`,
    );
    // TODO: dispatch to WebSocket gateway, push notifications, analytics, etc.
  }
}
