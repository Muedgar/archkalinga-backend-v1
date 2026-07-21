import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeProjectTemplateOptional1788600000000 implements MigrationInterface {
  name = 'MakeProjectTemplateOptional1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" ALTER COLUMN "templateId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "projects" ALTER COLUMN "template_id" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" ALTER COLUMN "template_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "projects" ALTER COLUMN "templateId" SET NOT NULL`);
  }
}
