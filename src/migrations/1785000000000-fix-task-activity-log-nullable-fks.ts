import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make `task_id` and `user_id` nullable on `task_activity_logs`.
 *
 * The table was originally created with `task_id integer NOT NULL` and
 * `user_id integer` (already nullable).  However the `TaskActivityLog`
 * entity does not expose a `@ManyToOne(() => Task)` relation, so TypeORM
 * never populates `task_id` on INSERT — causing a NOT NULL violation whenever
 * any code path (e.g. `logSeededTaskActivity`, `logTaskActivity`) saves an
 * activity log.
 *
 * The UUID column `taskId` already provides an unambiguous reference to the
 * task; the integer FK is redundant for application queries and is therefore
 * made nullable here so existing and future inserts succeed.
 *
 * A parallel fix is applied to `task_id` on `project_activity_logs` for the
 * same reason (the ProjectActivityLog entity sets `project` as a relation but
 * the `taskId` UUID is set without a corresponding task relation object).
 */
export class FixTaskActivityLogNullableFks1785000000000
  implements MigrationInterface
{
  name = 'FixTaskActivityLogNullableFks1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the NOT NULL constraint on task_id in task_activity_logs
    await queryRunner.query(`
      ALTER TABLE "task_activity_logs"
        ALTER COLUMN "task_id" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore NOT NULL — will fail if any rows have task_id = NULL
    await queryRunner.query(`
      ALTER TABLE "task_activity_logs"
        ALTER COLUMN "task_id" SET NOT NULL
    `);
  }
}
