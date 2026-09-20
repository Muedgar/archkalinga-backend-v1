import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProtectWorkspaceReportees1790000004000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE FUNCTION protect_workspace_reportee() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR NEW.status::text <> 'ACTIVE' THEN
          IF EXISTS(SELECT 1 FROM tasks t JOIN projects p ON p.id=t."projectId"
            WHERE p."workspaceId"=OLD."workspaceId" AND t."reporteeUserId"=OLD."userId" AND t."deletedAt" IS NULL) THEN
            RAISE EXCEPTION 'REPORTEE_OFFBOARDING_REQUIRES_RESOLUTION' USING ERRCODE='23514';
          END IF;
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
      END $$`);
    await q.query(
      `CREATE TRIGGER protect_workspace_reportee BEFORE UPDATE OF status OR DELETE ON workspace_members FOR EACH ROW EXECUTE FUNCTION protect_workspace_reportee()`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TRIGGER protect_workspace_reportee ON workspace_members`,
    );
    await q.query(`DROP FUNCTION protect_workspace_reportee()`);
  }
}
