import { MigrationInterface, QueryRunner } from 'typeorm';

// Superseded by the workspace refactor migration — kept as an empty stub so
// TypeORM migration history stays intact after db:fresh.
export class AllowTenantScoping1774017692983 implements MigrationInterface {
  name = 'AllowTenantScoping1774017692983';
  public async up(_queryRunner: QueryRunner): Promise<void> {}
  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
