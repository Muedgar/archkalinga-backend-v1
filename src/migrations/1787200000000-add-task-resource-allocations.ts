import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskResourceAllocations1787200000000
  implements MigrationInterface
{
  name = 'AddTaskResourceAllocations1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_resource_allocations" (
        "pkid"            SERIAL          NOT NULL,
        "id"              uuid            NOT NULL DEFAULT uuid_generate_v4(),
        "version"         integer         NOT NULL DEFAULT 1,
        "createdAt"       TIMESTAMP       NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP       NOT NULL DEFAULT now(),
        "task_id"         uuid            NOT NULL,
        "phase_code"      varchar(100),
        "phase_name"      varchar(500),
        "stage_code"      varchar(100),
        "stage_name"      varchar(500),
        "activity_code"   varchar(100),
        "activity_name"   varchar(500),
        "resource_type"   varchar(100)    NOT NULL,
        "resource_name"   varchar(255)    NOT NULL,
        "quantity"        numeric(14,2)   NOT NULL,
        "duration_days"   numeric(10,2),
        "default_rate"    numeric(14,2),
        "override_rate"   numeric(14,2),
        "effective_rate"  numeric(14,2),
        "cost_amount"     numeric(14,2),
        "currency"        varchar(3)      NOT NULL DEFAULT 'RWF',
        "status"          varchar(50),
        CONSTRAINT "UQ_task_resource_allocations_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_resource_allocations" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_resource_allocations_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_resource_allocations_task"
        ON "task_resource_allocations" ("task_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_resource_allocations_hierarchy"
        ON "task_resource_allocations" ("phase_code", "stage_code", "activity_code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_resource_allocations_activity_code"
        ON "task_resource_allocations" ("activity_code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_resource_allocations_resource"
        ON "task_resource_allocations" ("resource_type", "resource_name")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "task_resource_allocations" CASCADE`,
    );
  }
}
