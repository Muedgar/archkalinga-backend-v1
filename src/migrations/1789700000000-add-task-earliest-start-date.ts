import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskEarliestStartDate1789700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_activity_schedules" ADD COLUMN "earliest_start_date" date NULL`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_activity_schedules" DROP COLUMN "earliest_start_date"`,
    );
  }
}
