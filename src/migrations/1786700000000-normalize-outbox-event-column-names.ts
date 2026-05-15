import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeOutboxEventColumnNames1786700000000
  implements MigrationInterface
{
  name = 'NormalizeOutboxEventColumnNames1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'aggregateType',
      'aggregate_type',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'aggregateId',
      'aggregate_id',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'eventType',
      'event_type',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'retryCount',
      'retry_count',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'publishedAt',
      'published_at',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'errorMessage',
      'error_message',
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_outbox_events_status_created"
        ON "outbox_events" ("status", "createdAt")
        WHERE "status" = 'PENDING'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_outbox_events_aggregate"
        ON "outbox_events" ("aggregate_type", "aggregate_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_outbox_events_aggregate"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_outbox_events_status_created"`);

    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'error_message',
      'errorMessage',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'published_at',
      'publishedAt',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'retry_count',
      'retryCount',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'event_type',
      'eventType',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'aggregate_id',
      'aggregateId',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'outbox_events',
      'aggregate_type',
      'aggregateType',
    );
  }

  private async renameColumnIfNeeded(
    queryRunner: QueryRunner,
    tableName: string,
    from: string,
    to: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);

    if (table?.findColumnByName(from) && !table.findColumnByName(to)) {
      await queryRunner.query(`
        ALTER TABLE "${tableName}"
          RENAME COLUMN "${from}" TO "${to}"
      `);
    }
  }
}
