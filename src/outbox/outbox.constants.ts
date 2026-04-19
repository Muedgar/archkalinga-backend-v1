/** Bull queue that carries domain events after they leave the outbox. */
export const DOMAIN_EVENTS_QUEUE = 'domain-events';

/** Job type placed on DOMAIN_EVENTS_QUEUE for each published outbox event. */
export const DOMAIN_EVENT_JOB = 'domain-event';

/** Internal queue used to trigger the outbox flush loop. */
export const OUTBOX_QUEUE = 'outbox';

/** Job placed on OUTBOX_QUEUE after a transaction commits. */
export const OUTBOX_FLUSH_JOB = 'flush';

/** Maximum events flushed per tick (guards against thundering-herd). */
export const OUTBOX_BATCH_SIZE = 50;

/** Maximum retry attempts before an event is marked FAILED. */
export const OUTBOX_MAX_RETRIES = 5;
