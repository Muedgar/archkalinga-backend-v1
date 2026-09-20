import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { dataSourceOptions } from '../config/db/db.config';
import { AlignProjectMembershipInviteId1790000005000 } from '../migrations/1790000005000-align-project-membership-invite-id';

// Uses isolated, transaction-scoped tables; never changes application records.
const describeDatabase =
  process.env.RUN_DB_MIGRATION_TESTS === '1' ? describe : describe.skip;
describeDatabase('membership invite UUID migration (PostgreSQL)', () => {
  let db: DataSource;
  let runner: QueryRunner;
  const schema = `invite_migration_test_${randomUUID().replace(/-/g, '')}`;
  const inviteId = 'ee0cb00b-da17-4b8e-8a01-994391b350ef';
  const migration = new AlignProjectMembershipInviteId1790000005000();

  beforeAll(async () => {
    db = new DataSource({
      ...dataSourceOptions,
      schema,
      entities: [],
      migrations: [],
    });
    await db.initialize();
  });
  beforeEach(async () => {
    runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}"`);
    await runner.query(
      `CREATE TABLE project_invites (pkid integer PRIMARY KEY, id uuid UNIQUE NOT NULL)`,
    );
    await runner.query(`INSERT INTO project_invites VALUES (7, $1)`, [
      inviteId,
    ]);
  });
  afterEach(async () => {
    await runner.rollbackTransaction();
    await runner.release();
  });
  afterAll(async () => {
    await db.destroy();
  });

  it('preserves integer and legacy UUID links, accepts UUID inserts, and rolls back', async () => {
    await runner.query(`CREATE TABLE project_memberships (
      pkid integer PRIMARY KEY, invite_id integer REFERENCES project_invites(pkid), "inviteId" uuid
    )`);
    await runner.query(
      `INSERT INTO project_memberships VALUES (1, 7, NULL), (2, NULL, $1), (3, NULL, NULL)`,
      [inviteId],
    );
    await migration.up(runner);
    expect(
      await runner.query(
        `SELECT invite_id FROM project_memberships ORDER BY pkid`,
      ),
    ).toEqual([
      { invite_id: inviteId },
      { invite_id: inviteId },
      { invite_id: null },
    ]);
    // This insert failed with 22P02 in the reported accept-invite transaction.
    await runner.query(
      `INSERT INTO project_memberships (pkid, invite_id) VALUES (4, $1)`,
      [inviteId],
    );
    await migration.down(runner);
    expect(
      await runner.query(
        `SELECT invite_id, "inviteId" FROM project_memberships WHERE pkid=4`,
      ),
    ).toEqual([{ invite_id: 7, inviteId }]);
    await migration.up(runner);
    await runner.query(`DELETE FROM project_invites WHERE pkid=7`);
    expect(
      await runner.query(
        `SELECT invite_id FROM project_memberships WHERE pkid=4`,
      ),
    ).toEqual([{ invite_id: null }]);
  });

  it('supports databases where the original UUID migration already ran correctly', async () => {
    await runner.query(
      `CREATE TABLE project_memberships (pkid integer PRIMARY KEY, invite_id uuid)`,
    );
    await runner.query(`INSERT INTO project_memberships VALUES (1, $1)`, [
      inviteId,
    ]);
    await migration.up(runner);
    expect(
      await runner.query(`SELECT invite_id FROM project_memberships`),
    ).toEqual([{ invite_id: inviteId }]);
  });

  it('refuses conflicting legacy links instead of replacing one silently', async () => {
    await runner.query(
      `CREATE TABLE project_memberships (pkid integer PRIMARY KEY, invite_id integer, "inviteId" uuid)`,
    );
    await runner.query(`INSERT INTO project_memberships VALUES (1, 7, $1)`, [
      randomUUID(),
    ]);
    await expect(migration.up(runner)).rejects.toThrow(
      'Conflicting membership invite references',
    );
  });
});
