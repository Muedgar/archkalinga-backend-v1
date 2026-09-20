import { MigrationInterface, QueryRunner, TableForeignKey } from 'typeorm';

/** Align the persisted relation with ProjectMembership.inviteId (the public UUID). */
export class AlignProjectMembershipInviteId1790000005000 implements MigrationInterface {
  name = 'AlignProjectMembershipInviteId1790000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('project_memberships');
    if (!table) throw new Error('project_memberships table is missing');
    const column = table.findColumnByName('invite_id');
    const legacyColumn = table.findColumnByName('inviteId');
    if (column && !['integer', 'int', 'int4', 'uuid'].includes(column.type)) {
      throw new Error(
        `Unsupported project_memberships.invite_id type: ${column.type}`,
      );
    }

    for (const fk of table.foreignKeys.filter((key) =>
      key.columnNames.includes('invite_id'),
    )) {
      await queryRunner.dropForeignKey(table, fk);
    }

    if (column && column.type !== 'uuid') {
      // Resolve integer primary keys through project_invites; casting integers
      // to UUIDs would lose the original relationship.
      await queryRunner.query(
        `ALTER TABLE "project_memberships" ADD COLUMN "__invite_uuid" uuid`,
      );
      await queryRunner.query(`
        UPDATE "project_memberships" m SET "__invite_uuid" = i."id"
        FROM "project_invites" i WHERE m."invite_id" = i."pkid"
      `);
      const unresolved = await queryRunner.query(`
        SELECT 1 FROM "project_memberships"
        WHERE "invite_id" IS NOT NULL AND "__invite_uuid" IS NULL LIMIT 1
      `);
      if (unresolved.length)
        throw new Error(
          'Cannot resolve an existing membership invite reference',
        );
      await queryRunner.query(`
        ALTER TABLE "project_memberships" ALTER COLUMN "invite_id" TYPE uuid USING "__invite_uuid"
      `);
      await queryRunner.query(
        `ALTER TABLE "project_memberships" DROP COLUMN "__invite_uuid"`,
      );
    } else if (!column) {
      await queryRunner.query(
        `ALTER TABLE "project_memberships" ADD COLUMN "invite_id" uuid`,
      );
    }

    if (legacyColumn) {
      const conflicts = await queryRunner.query(`
        SELECT 1 FROM "project_memberships"
        WHERE "invite_id" IS NOT NULL AND "inviteId" IS NOT NULL
          AND "invite_id" <> "inviteId" LIMIT 1
      `);
      if (conflicts.length)
        throw new Error(
          'Conflicting membership invite references require review',
        );
      await queryRunner.query(`
        UPDATE "project_memberships" SET "invite_id" = "inviteId"
        WHERE "invite_id" IS NULL AND "inviteId" IS NOT NULL
      `);
      // Keep the legacy column for rollback compatibility; the entity no longer writes it.
    }

    await queryRunner.createForeignKey(
      'project_memberships',
      new TableForeignKey({
        name: 'FK_project_memberships_invite_uuid',
        columnNames: ['invite_id'],
        referencedTableName: 'project_invites',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('project_memberships');
    if (!table) throw new Error('project_memberships table is missing');
    for (const fk of table.foreignKeys.filter((key) =>
      key.columnNames.includes('invite_id'),
    )) {
      await queryRunner.dropForeignKey(table, fk);
    }
    if (!table.findColumnByName('inviteId')) {
      await queryRunner.query(
        `ALTER TABLE "project_memberships" ADD COLUMN "inviteId" uuid`,
      );
    }
    await queryRunner.query(
      `UPDATE "project_memberships" SET "inviteId" = "invite_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_memberships" ADD COLUMN "__invite_pkid" integer`,
    );
    await queryRunner.query(`
      UPDATE "project_memberships" m SET "__invite_pkid" = i."pkid"
      FROM "project_invites" i WHERE m."invite_id" = i."id"
    `);
    await queryRunner.query(`
      ALTER TABLE "project_memberships" ALTER COLUMN "invite_id" TYPE integer USING "__invite_pkid"
    `);
    await queryRunner.query(
      `ALTER TABLE "project_memberships" DROP COLUMN "__invite_pkid"`,
    );
    await queryRunner.createForeignKey(
      'project_memberships',
      new TableForeignKey({
        name: 'FK_project_memberships_invite_pkid',
        columnNames: ['invite_id'],
        referencedTableName: 'project_invites',
        referencedColumnNames: ['pkid'],
        onDelete: 'SET NULL',
      }),
    );
  }
}
