/** Payload shape for a single domain event published to the Bull queue. */
export interface DomainEventJobPayload {
  /** The outbox event's own UUID — for idempotency on the consumer side. */
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** ISO-8601 timestamp when the event was persisted. */
  occurredAt: string;
}

/** Input expected by OutboxService.record(). */
export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}
