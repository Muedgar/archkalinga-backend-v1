import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskMaterials1787300000000 implements MigrationInterface {
  name = 'AddTaskMaterials1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_materials" (
        "pkid"              SERIAL          NOT NULL,
        "id"                uuid            NOT NULL DEFAULT uuid_generate_v4(),
        "version"           integer         NOT NULL DEFAULT 1,
        "createdAt"         TIMESTAMP       NOT NULL DEFAULT now(),
        "updatedAt"         TIMESTAMP       NOT NULL DEFAULT now(),
        "task_id"           uuid            NOT NULL,
        "phase_code"        varchar(100),
        "stage_code"        varchar(100),
        "activity_code"     varchar(100),
        "activity_name"     varchar(500),
        "task_code"         varchar(100),
        "task_name"         varchar(500),
        "material_category" varchar(100)    NOT NULL,
        "material_name"     varchar(255)    NOT NULL,
        "unit"              varchar(50),
        "quantity"          numeric(14,2)   NOT NULL,
        "default_rate"      numeric(14,2),
        "waste_percent"     numeric(8,4),
        "material_cost"     numeric(14,2),
        "currency"          varchar(3)      NOT NULL DEFAULT 'RWF',
        "lookup_status"     varchar(50),
        CONSTRAINT "UQ_task_materials_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_materials" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_materials_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_materials_task"
        ON "task_materials" ("task_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_materials_hierarchy"
        ON "task_materials" ("phase_code", "stage_code", "activity_code", "task_code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_materials_activity_code"
        ON "task_materials" ("activity_code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_materials_material"
        ON "task_materials" ("material_category", "material_name")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "task_materials" CASCADE`);
  }
}
