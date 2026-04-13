import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTasks1774300000000 implements MigrationInterface {
  name = 'CreateTasks1774300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."tasks_status_enum"
          AS ENUM('TODO','IN_PROGRESS','IN_REVIEW','DONE','BLOCKED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."tasks_priority_enum"
          AS ENUM('LOW','MEDIUM','HIGH','URGENT');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."task_assignees_assignment_role_enum"
          AS ENUM('OWNER','CONTRIBUTOR','REVIEWER');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."task_dependencies_dependency_type_enum"
          AS ENUM('FS','SS','FF','SF');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."task_view_metadata_view_type_enum"
          AS ENUM('mindmap','gantt');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."task_activity_logs_action_type_enum"
          AS ENUM(
            'TASK_CREATED',
            'TASK_UPDATED',
            'TASK_MOVED',
            'TASK_DELETED',
            'TASK_ASSIGNED',
            'TASK_UNASSIGNED',
            'COMMENT_ADDED',
            'STATUS_CHANGED',
            'CHECKLIST_UPDATED',
            'DEPENDENCY_ADDED'
          );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_columns" (
        "pkid"         SERIAL NOT NULL,
        "id"           uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"      integer NOT NULL DEFAULT '1',
        "createdAt"    TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"    TIMESTAMP NOT NULL DEFAULT now(),
        "projectId"    uuid NOT NULL,
        "name"         character varying(200) NOT NULL,
        "statusKey"    character varying(100),
        "orderIndex"   integer NOT NULL DEFAULT '0',
        "wipLimit"     integer,
        "locked"       boolean NOT NULL DEFAULT false,
        "project_id"   integer NOT NULL,
        CONSTRAINT "UQ_workflow_columns_id" UNIQUE ("id"),
        CONSTRAINT "PK_workflow_columns_pkid" PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tasks" (
        "pkid"               SERIAL NOT NULL,
        "id"                 uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"            integer NOT NULL DEFAULT '1',
        "createdAt"          TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"          TIMESTAMP NOT NULL DEFAULT now(),
        "title"              character varying(500) NOT NULL,
        "description"        text,
        "status"             "public"."tasks_status_enum" NOT NULL DEFAULT 'TODO',
        "priority"           "public"."tasks_priority_enum",
        "startDate"          date,
        "endDate"            date,
        "progress"           smallint,
        "completed"          boolean NOT NULL DEFAULT false,
        "workflowColumnId"   uuid,
        "rank"               character varying(50),
        "parentTaskId"       uuid,
        "projectId"          uuid NOT NULL,
        "createdByUserId"    uuid NOT NULL,
        "reporteeUserId"     uuid,
        "deletedAt"          TIMESTAMP WITH TIME ZONE,
        "workflow_column_id" integer,
        "parent_task_id"     integer,
        "project_id"         integer NOT NULL,
        "created_by_user_id" integer NOT NULL,
        "reportee_user_id"   integer,
        CONSTRAINT "UQ_tasks_id" UNIQUE ("id"),
        CONSTRAINT "CHK_tasks_progress_range" CHECK ("progress" BETWEEN 0 AND 100),
        CONSTRAINT "PK_tasks_pkid" PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_assignees" (
        "pkid"            SERIAL NOT NULL,
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"         integer NOT NULL DEFAULT '1',
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "taskId"          uuid NOT NULL,
        "userId"          uuid NOT NULL,
        "assignmentRole"  "public"."task_assignees_assignment_role_enum" NOT NULL DEFAULT 'CONTRIBUTOR',
        "task_id"         integer NOT NULL,
        "user_id"         integer NOT NULL,
        CONSTRAINT "UQ_task_assignees_id" UNIQUE ("id"),
        CONSTRAINT "UQ_task_assignees_task_user" UNIQUE ("taskId", "userId"),
        CONSTRAINT "PK_task_assignees_pkid" PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_checklist_items" (
        "pkid"                SERIAL NOT NULL,
        "id"                  uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"             integer NOT NULL DEFAULT '1',
        "createdAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "taskId"              uuid NOT NULL,
        "text"                character varying(500) NOT NULL,
        "completed"           boolean NOT NULL DEFAULT false,
        "orderIndex"          integer NOT NULL DEFAULT '0',
        "completedByUserId"   uuid,
        "completedAt"         TIMESTAMP WITH TIME ZONE,
        "task_id"             integer NOT NULL,
        CONSTRAINT "UQ_task_checklist_items_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_checklist_items_pkid" PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_comments" (
        "pkid"               SERIAL NOT NULL,
        "id"                 uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"            integer NOT NULL DEFAULT '1',
        "createdAt"          TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"          TIMESTAMP NOT NULL DEFAULT now(),
        "taskId"             uuid NOT NULL,
        "authorUserId"       uuid NOT NULL,
        "body"               text NOT NULL,
        "parentCommentId"    uuid,
        "deletedAt"          TIMESTAMP WITH TIME ZONE,
        "task_id"            integer NOT NULL,
        "author_user_id"     integer NOT NULL,
        CONSTRAINT "UQ_task_comments_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_comments_pkid" PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_dependencies" (
        "pkid"                SERIAL NOT NULL,
        "id"                  uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"             integer NOT NULL DEFAULT '1',
        "createdAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "taskId"              uuid NOT NULL,
        "dependsOnTaskId"     uuid NOT NULL,
        "dependencyType"      "public"."task_dependencies_dependency_type_enum" NOT NULL DEFAULT 'FS',
        "lagDays"             integer,
        "task_id"             integer NOT NULL,
        "depends_on_task_id"  integer NOT NULL,
        CONSTRAINT "UQ_task_dependencies_id" UNIQUE ("id"),
        CONSTRAINT "UQ_task_dependencies_task_depends_on" UNIQUE ("taskId", "dependsOnTaskId"),
        CONSTRAINT "CHK_task_dependencies_no_self" CHECK ("taskId" <> "dependsOnTaskId"),
        CONSTRAINT "PK_task_dependencies_pkid" PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_view_metadata" (
        "pkid"         SERIAL NOT NULL,
        "id"           uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"      integer NOT NULL DEFAULT '1',
        "createdAt"    TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"    TIMESTAMP NOT NULL DEFAULT now(),
        "taskId"       uuid NOT NULL,
        "viewType"     "public"."task_view_metadata_view_type_enum" NOT NULL,
        "metaJson"     jsonb NOT NULL DEFAULT '{}',
        "task_id"      integer NOT NULL,
        CONSTRAINT "UQ_task_view_metadata_id" UNIQUE ("id"),
        CONSTRAINT "UQ_task_view_metadata_task_view" UNIQUE ("taskId", "viewType"),
        CONSTRAINT "PK_task_view_metadata_pkid" PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_activity_logs" (
        "pkid"             SERIAL NOT NULL,
        "id"               uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"          integer NOT NULL DEFAULT '1',
        "createdAt"        TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP NOT NULL DEFAULT now(),
        "taskId"           uuid NOT NULL,
        "projectId"        uuid NOT NULL,
        "actorUserId"      uuid NOT NULL,
        "actionType"       "public"."task_activity_logs_action_type_enum" NOT NULL,
        "actionMeta"       jsonb DEFAULT '{}',
        "actor_user_id"    integer NOT NULL,
        CONSTRAINT "UQ_task_activity_logs_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_activity_logs_pkid" PRIMARY KEY ("pkid")
      )
    `);

    const fks = [
      `ALTER TABLE "workflow_columns" ADD CONSTRAINT "FK_workflow_columns_project_id"
         FOREIGN KEY ("project_id") REFERENCES "projects"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_workflow_column_id"
         FOREIGN KEY ("workflow_column_id") REFERENCES "workflow_columns"("pkid") ON DELETE SET NULL`,
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_parent_task_id"
         FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_project_id"
         FOREIGN KEY ("project_id") REFERENCES "projects"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_created_by_user_id"
         FOREIGN KEY ("created_by_user_id") REFERENCES "users"("pkid") ON DELETE RESTRICT`,
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_reportee_user_id"
         FOREIGN KEY ("reportee_user_id") REFERENCES "users"("pkid") ON DELETE SET NULL`,
      `ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_task_assignees_task_id"
         FOREIGN KEY ("task_id") REFERENCES "tasks"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_task_assignees_user_id"
         FOREIGN KEY ("user_id") REFERENCES "users"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "task_checklist_items" ADD CONSTRAINT "FK_task_checklist_items_task_id"
         FOREIGN KEY ("task_id") REFERENCES "tasks"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "task_comments" ADD CONSTRAINT "FK_task_comments_task_id"
         FOREIGN KEY ("task_id") REFERENCES "tasks"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "task_comments" ADD CONSTRAINT "FK_task_comments_author_user_id"
         FOREIGN KEY ("author_user_id") REFERENCES "users"("pkid") ON DELETE RESTRICT`,
      `ALTER TABLE "task_dependencies" ADD CONSTRAINT "FK_task_dependencies_task_id"
         FOREIGN KEY ("task_id") REFERENCES "tasks"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "task_dependencies" ADD CONSTRAINT "FK_task_dependencies_depends_on_task_id"
         FOREIGN KEY ("depends_on_task_id") REFERENCES "tasks"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "task_view_metadata" ADD CONSTRAINT "FK_task_view_metadata_task_id"
         FOREIGN KEY ("task_id") REFERENCES "tasks"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "task_activity_logs" ADD CONSTRAINT "FK_task_activity_logs_actor_user_id"
         FOREIGN KEY ("actor_user_id") REFERENCES "users"("pkid") ON DELETE RESTRICT`,
    ];

    for (const fk of fks) {
      await queryRunner.query(
        `DO $$ BEGIN ${fk}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      );
    }

    const indexes = [
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_project_parent_deleted"
        ON "tasks" ("projectId", "parentTaskId", "deletedAt")`,
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_project_column_rank_deleted"
        ON "tasks" ("projectId", "workflowColumnId", "rank", "deletedAt")`,
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_project_dates_deleted"
        ON "tasks" ("projectId", "startDate", "endDate", "deletedAt")`,
      `CREATE INDEX IF NOT EXISTS "IDX_task_assignees_task_user"
        ON "task_assignees" ("taskId", "userId")`,
      `CREATE INDEX IF NOT EXISTS "IDX_task_dependencies_task_depends_on"
        ON "task_dependencies" ("taskId", "dependsOnTaskId")`,
      `CREATE INDEX IF NOT EXISTS "IDX_task_comments_task_created_at"
        ON "task_comments" ("taskId", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "IDX_task_activity_logs_task_created_at"
        ON "task_activity_logs" ("taskId", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "IDX_task_activity_logs_project_created_at"
        ON "task_activity_logs" ("projectId", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "IDX_workflow_columns_project_order"
        ON "workflow_columns" ("projectId", "orderIndex")`,
    ];

    for (const index of indexes) {
      await queryRunner.query(index);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "task_activity_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_view_metadata"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_dependencies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_checklist_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_assignees"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_columns"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."task_activity_logs_action_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."task_view_metadata_view_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."task_dependencies_dependency_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."task_assignees_assignment_role_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."tasks_priority_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."tasks_status_enum"`);
  }
}
