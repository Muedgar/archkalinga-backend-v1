import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bull';
import { EntityManager, In, LessThan, Repository } from 'typeorm';
import { OutboxEvent, OutboxEventStatus } from './outbox-event.entity';
import {
  DOMAIN_EVENT_JOB,
  DOMAIN_EVENTS_QUEUE,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_RETRIES,
} from './outbox.constants';
import type { DomainEventJobPayload, OutboxEventInput } from './outbox.types';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    @InjectQueue(DOMAIN_EVENTS_QUEUE)
    private readonly domainEventsQueue: Queue<DomainEventJobPayload>,
  ) {}

  /**
   * Write an outbox event inside an existing transaction.
   *
   * Must be called with the `EntityManager` of the surrounding transaction
   * so the event row is committed or rolled back atomically with the mutation.
   *
   * @example
   * await this.outboxService.record(tx, {
   *   aggregateType: 'task',
   *   aggregateId: task.id,
   *   eventType: 'task.created',
   *   payload: { projectId, actorUserId: actorUser.id, title: task.title },
   * });
   */
  async record(manager: EntityManager, input: OutboxEventInput): Promise<void> {
    await manager.save(
      manager.create(OutboxEvent, {
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: input.payload,
        status: OutboxEventStatus.PENDING,
        retryCount: 0,
        publishedAt: null,
        errorMessage: null,
      }),
    );
  }

  /**
   * Write an outbox event outside of an existing transaction.
   *
   * Use this when the calling code does not have an open `EntityManager`
   * (e.g. config mutations that save directly via the repository).
   * The write is not atomic with the preceding save, so there is a small
   * window where the mutation succeeds but the event is not recorded if the
   * process crashes between the two writes.  For low-frequency config changes
   * this trade-off is acceptable; wrap in `record()` when full atomicity is required.
   */
  async recordNow(input: OutboxEventInput): Promise<void> {
    await this.outboxRepo.save(
      this.outboxRepo.create({
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: input.payload,
        status: OutboxEventStatus.PENDING,
        retryCount: 0,
        publishedAt: null,
        errorMessage: null,
      }),
    );
  }

  /**
   * Poll PENDING outbox events and forward them to the domain-events queue.
   *
   * Called by OutboxPublisherService on a repeating Bull schedule.
   * Processes events in creation order, OUTBOX_BATCH_SIZE at a time.
   * On Bull enqueue failure the event's retryCount is incremented;
   * after OUTBOX_MAX_RETRIES it is marked FAILED so it doesn't block the queue.
   */
  async flush(): Promise<{ published: number; failed: number }> {
    const events = await this.outboxRepo.find({
      where: { status: OutboxEventStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: OUTBOX_BATCH_SIZE,
    });

    if (!events.length) return { published: 0, failed: 0 };

    let published = 0;
    let failed = 0;

    for (const event of events) {
      try {
        const jobPayload: DomainEventJobPayload = {
          eventId: event.id,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          payload: event.payload,
          occurredAt: event.createdAt.toISOString(),
        };

        // Use the event UUID as the Bull job ID for idempotency.
        await this.domainEventsQueue.add(DOMAIN_EVENT_JOB, jobPayload, {
          jobId: event.id,
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        });

        event.status = OutboxEventStatus.PUBLISHED;
        event.publishedAt = new Date();
        event.errorMessage = null;
        published++;
      } catch (err) {
        event.retryCount += 1;
        event.errorMessage =
          err instanceof Error ? err.message : String(err);

        if (event.retryCount >= OUTBOX_MAX_RETRIES) {
          event.status = OutboxEventStatus.FAILED;
          this.logger.error(
            `Outbox event ${event.id} (${event.eventType}) permanently failed after ${event.retryCount} retries`,
          );
          failed++;
        } else {
          this.logger.warn(
            `Outbox event ${event.id} (${event.eventType}) failed, retry ${event.retryCount}/${OUTBOX_MAX_RETRIES}: ${event.errorMessage}`,
          );
        }
      }
    }

    // Batch-save all updated event rows at once instead of one UPDATE per event
    if (events.length > 0) {
      await this.outboxRepo.save(events);
    }

    if (published > 0) {
      this.logger.debug(`Outbox flush: ${published} published, ${failed} failed`);
    }

    return { published, failed };
  }

  /**
   * Permanently delete PUBLISHED events older than `olderThanDays` days.
   * Called by the nightly cleanup job in OutboxPublisherService.
   */
  async prunePublished(olderThanDays = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = await this.outboxRepo.delete({
      status: OutboxEventStatus.PUBLISHED,
      publishedAt: LessThan(cutoff),
    });

    return (result.affected ?? 0);
  }

  /**
   * Re-queue FAILED events for retry (manual recovery path).
   * Resets status back to PENDING and clears retryCount.
   */
  async requeueFailed(ids?: string[]): Promise<number> {
    const where = ids?.length
      ? { status: OutboxEventStatus.FAILED, id: In(ids) }
      : { status: OutboxEventStatus.FAILED };

    const result = await this.outboxRepo.update(where, {
      status: OutboxEventStatus.PENDING,
      retryCount: 0,
      errorMessage: null,
    });

    return (result.affected ?? 0);
  }
}
