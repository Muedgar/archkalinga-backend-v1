import { Column, Entity } from 'typeorm';
import { SnakeCaseAppBaseEntity } from 'src/common/entities';

export enum OutboxEventStatus {
  PENDING = 'PENDING',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
}

/**
 * Transactional Outbox Event.
 *
 * Written atomically inside service mutations so they are never lost
 * even if the process crashes before reaching the message broker.
 * OutboxPublisherService polls PENDING rows and forwards them to
 * the domain-events Bull queue.
 */
@Entity('outbox_events')
export class OutboxEvent extends SnakeCaseAppBaseEntity {
  /** Domain entity type — e.g. 'task' | 'project' | 'project-config' | 'project-member' */
  @Column({ name: 'aggregate_type', type: 'varchar', length: 100, nullable: false })
  aggregateType: string;

  /** UUID of the root aggregate (taskId, projectId, …) */
  @Column({ name: 'aggregate_id', type: 'uuid', nullable: false })
  aggregateId: string;

  /**
   * Dot-separated event type string.
   * Examples: 'task.created', 'task.status.changed', 'project.member.updated'
   */
  @Column({ name: 'event_type', type: 'varchar', length: 150, nullable: false })
  eventType: string;

  /**
   * Full event payload carrying enough context for downstream consumers
   * to act without additional DB lookups where possible.
   * Shape: { actorUserId, projectId, ...delta }
   */
  @Column({ type: 'jsonb', nullable: false, default: {} })
  payload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: OutboxEventStatus,
    default: OutboxEventStatus.PENDING,
  })
  status: OutboxEventStatus;

  @Column({ name: 'retry_count', type: 'smallint', default: 0 })
  retryCount: number;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
}
