import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Workspace Refactor Migration
 *
 * Replaces the `organizations` model with a `workspaces` model.
 * Key changes:
 *   - `organizations` table dropped; replaced by `workspaces`
 *   - `workspace_roles` replaces `roles` (scoped per workspace, adds isSystem flag)
 *   - `workspace_members` is the new join table (user + workspace + role)
 *   - `permissions` is a new global catalogue, seeded separately
 *   - `users` no longer carry organizationId, userType, or roleId
 *   - `templates` and `projects` reference workspaceId instead of organizationId
 *   - All task-related, invite, and project-role tables are preserved as-is
 *
 * After running this migration, execute: npm run seed:permissions
 */
export class WorkspaceRefactor1776000000000 implements MigrationInterface {
  name = 'WorkspaceRefactor1776000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Extensions ────────────────────────────────────────────────────────────
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── Workspaces ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "workspaces" (
        "pkid"        SERIAL        NOT NULL,
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"     integer       NOT NULL DEFAULT '1',
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "name"        varchar(200)  NOT NULL,
        "slug"        varchar(220)  NOT NULL,
        "description" text,
        CONSTRAINT "UQ_workspaces_id"   UNIQUE ("id"),
        CONSTRAINT "UQ_workspaces_slug" UNIQUE ("slug"),
        CONSTRAINT "PK_workspaces"      PRIMARY KEY ("pkid")
      )
    `);

    // ── Users ─────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "users" (
        "pkid"                        SERIAL        NOT NULL,
        "id"                          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"                     integer       NOT NULL DEFAULT '1',
        "createdAt"                   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"                   TIMESTAMP     NOT NULL DEFAULT now(),
        "userName"                    varchar(200),
        "firstName"                   varchar(200)  NOT NULL,
        "lastName"                    varchar(200)  NOT NULL,
        "email"                       varchar(100)  NOT NULL,
        "password"                    varchar(250)  NOT NULL,
        "title"                       varchar(200),
        "status"                      boolean       NOT NULL DEFAULT true,
        "isDefaultPassword"           boolean       NOT NULL DEFAULT true,
        "twoFactorAuthentication"     boolean       NOT NULL DEFAULT false,
        "emailVerified"               boolean       NOT NULL DEFAULT false,
        "emailVerificationKey"        varchar(250),
        "emailVerificationExpiry"     TIMESTAMP WITH TIME ZONE,
        "tokenVersion"                integer       NOT NULL DEFAULT '0',
        "failedLoginAttempts"         integer       NOT NULL DEFAULT '0',
        "lockedUntil"                 TIMESTAMP WITH TIME ZONE,
        "passwordResetTokenHash"      varchar(64),
        "passwordResetTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "passwordResetTokenUsedAt"    TIMESTAMP WITH TIME ZONE,
        "createdById"                 uuid,
        "created_by_id"               integer,
        CONSTRAINT "UQ_users_id"    UNIQUE ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users"       PRIMARY KEY ("pkid")
      )
    `);

    // ── User profiles ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "user_profiles" (
        "pkid"       SERIAL        NOT NULL,
        "id"         uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"    integer       NOT NULL DEFAULT '1',
        "createdAt"  TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"  TIMESTAMP     NOT NULL DEFAULT now(),
        "userId"     uuid          NOT NULL,
        "profession" varchar(200),
        "specialty"  varchar(200),
        "bio"        text,
        "user_id"    integer       NOT NULL,
        CONSTRAINT "UQ_user_profiles_id"      UNIQUE ("id"),
        CONSTRAINT "REL_user_profiles_user_id" UNIQUE ("user_id"),
        CONSTRAINT "PK_user_profiles"          PRIMARY KEY ("pkid")
      )
    `);

    // ── User sessions ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "user_sessions" (
        "pkid"              SERIAL        NOT NULL,
        "id"                uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"           integer       NOT NULL DEFAULT '1',
        "createdAt"         TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"         TIMESTAMP     NOT NULL DEFAULT now(),
        "refreshTokenHash"  varchar(64)   NOT NULL,
        "ipAddress"         varchar(45),
        "deviceLabel"       varchar(250),
        "expiresAt"         TIMESTAMP WITH TIME ZONE NOT NULL,
        "lastUsedAt"        TIMESTAMP WITH TIME ZONE,
        "revokedAt"         TIMESTAMP WITH TIME ZONE,
        "user_id"           integer       NOT NULL,
        CONSTRAINT "UQ_user_sessions_id"               UNIQUE ("id"),
        CONSTRAINT "UQ_user_sessions_refreshTokenHash" UNIQUE ("refreshTokenHash"),
        CONSTRAINT "PK_user_sessions"                  PRIMARY KEY ("pkid")
      )
    `);

    // ── Workspace roles ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "workspace_roles" (
        "pkid"         SERIAL        NOT NULL,
        "id"           uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"      integer       NOT NULL DEFAULT '1',
        "createdAt"    TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"    TIMESTAMP     NOT NULL DEFAULT now(),
        "name"         varchar(100)  NOT NULL,
        "slug"         varchar(100)  NOT NULL,
        "status"       boolean       NOT NULL DEFAULT true,
        "permissions"  jsonb         NOT NULL,
        "isSystem"     boolean       NOT NULL DEFAULT false,
        "workspaceId"  uuid          NOT NULL,
        "workspace_id" integer       NOT NULL,
        CONSTRAINT "UQ_workspace_roles_id" UNIQUE ("id"),
        CONSTRAINT "PK_workspace_roles"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Workspace members ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."workspace_members_status_enum"
        AS ENUM('ACTIVE', 'REMOVED')
    `);

    await queryRunner.query(`
      CREATE TABLE "workspace_members" (
        "pkid"                SERIAL        NOT NULL,
        "id"                  uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"             integer       NOT NULL DEFAULT '1',
        "createdAt"           TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP     NOT NULL DEFAULT now(),
        "workspaceId"         uuid          NOT NULL,
        "userId"              uuid          NOT NULL,
        "workspaceRoleId"     uuid          NOT NULL,
        "status"              "public"."workspace_members_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "joinedAt"            TIMESTAMP WITH TIME ZONE,
        "invitedByUserId"     uuid,
        "workspace_id"        integer       NOT NULL,
        "user_id"             integer       NOT NULL,
        "workspace_role_id"   integer       NOT NULL,
        "invited_by_user_id"  integer,
        CONSTRAINT "UQ_workspace_members_id"              UNIQUE ("id"),
        CONSTRAINT "UQ_workspace_members_workspace_user"  UNIQUE ("workspace_id", "user_id"),
        CONSTRAINT "PK_workspace_members"                 PRIMARY KEY ("pkid")
      )
    `);

    // ── Global permissions catalogue ──────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "pkid"        SERIAL        NOT NULL,
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "domain"      varchar(100)  NOT NULL,
        "action"      varchar(50)   NOT NULL,
        "description" varchar(300),
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_permissions_id"            UNIQUE ("id"),
        CONSTRAINT "UQ_permissions_domain_action" UNIQUE ("domain", "action"),
        CONSTRAINT "PK_permissions"               PRIMARY KEY ("pkid")
      )
    `);

    // ── Audit logs ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "pkid"       SERIAL        NOT NULL,
        "id"         uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "action"     varchar(100)  NOT NULL,
        "resource"   varchar(100)  NOT NULL,
        "resourceId" varchar,
        "payload"    jsonb,
        "result"     jsonb,
        "ipAddress"  varchar(45),
        "createdAt"  TIMESTAMP     NOT NULL DEFAULT now(),
        "actor_id"   integer,
        CONSTRAINT "UQ_audit_logs_id" UNIQUE ("id"),
        CONSTRAINT "PK_audit_logs"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Templates ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "templates" (
        "pkid"         SERIAL        NOT NULL,
        "id"           uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"      integer       NOT NULL DEFAULT '1',
        "createdAt"    TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"    TIMESTAMP     NOT NULL DEFAULT now(),
        "name"         varchar(80)   NOT NULL,
        "description"  varchar(800)  NOT NULL,
        "isDefault"    boolean       NOT NULL DEFAULT false,
        "workspaceId"  uuid          NOT NULL,
        "workspace_id" integer       NOT NULL,
        CONSTRAINT "UQ_templates_id"             UNIQUE ("id"),
        CONSTRAINT "UQ_templates_workspace_name" UNIQUE ("workspace_id", "name"),
        CONSTRAINT "PK_templates"                PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "template_tasks" (
        "pkid"           SERIAL        NOT NULL,
        "id"             uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"        integer       NOT NULL DEFAULT '1',
        "createdAt"      TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMP     NOT NULL DEFAULT now(),
        "name"           varchar(200)  NOT NULL,
        "description"    text,
        "order"          integer       NOT NULL DEFAULT '0',
        "templateId"     uuid          NOT NULL,
        "parentTaskId"   uuid,
        "template_id"    integer       NOT NULL,
        "parent_task_id" integer,
        CONSTRAINT "UQ_template_tasks_id" UNIQUE ("id"),
        CONSTRAINT "PK_template_tasks"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Project roles ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "project_roles" (
        "pkid"        SERIAL        NOT NULL,
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"     integer       NOT NULL DEFAULT '1',
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "name"        varchar(100)  NOT NULL,
        "slug"        varchar(100)  NOT NULL,
        "status"      boolean       NOT NULL DEFAULT true,
        "permissions" jsonb         NOT NULL DEFAULT '{}',
        "isSystem"    boolean       NOT NULL DEFAULT false,
        "projectId"   uuid          NOT NULL,
        "project_id"  integer       NOT NULL,
        CONSTRAINT "UQ_project_roles_id" UNIQUE ("id"),
        CONSTRAINT "PK_project_roles"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Projects ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."projects_type_enum"
        AS ENUM('ARCHITECTURE', 'STRUCTURE', 'MEP', 'INTERIOR')
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."projects_status_enum"
        AS ENUM('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED')
    `);

    await queryRunner.query(`
      CREATE TABLE "projects" (
        "pkid"          SERIAL        NOT NULL,
        "id"            uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"       integer       NOT NULL DEFAULT '1',
        "createdAt"     TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"     TIMESTAMP     NOT NULL DEFAULT now(),
        "title"         varchar(200)  NOT NULL,
        "description"   text,
        "startDate"     date,
        "endDate"       date,
        "type"          "public"."projects_type_enum"   NOT NULL,
        "status"        "public"."projects_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "archivedAt"    TIMESTAMP WITH TIME ZONE,
        "workspaceId"   uuid          NOT NULL,
        "templateId"    uuid          NOT NULL,
        "createdByUserId" uuid        NOT NULL,
        "workspace_id"  integer       NOT NULL,
        "template_id"   integer       NOT NULL,
        "created_by_id" integer       NOT NULL,
        CONSTRAINT "UQ_projects_id" UNIQUE ("id"),
        CONSTRAINT "PK_projects"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Project memberships ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."project_memberships_status_enum"
        AS ENUM('ACTIVE', 'REMOVED', 'LEFT')
    `);

    await queryRunner.query(`
      CREATE TABLE "project_memberships" (
        "pkid"                  SERIAL        NOT NULL,
        "id"                    uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"               integer       NOT NULL DEFAULT '1',
        "createdAt"             TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"             TIMESTAMP     NOT NULL DEFAULT now(),
        "projectId"             uuid          NOT NULL,
        "userId"                uuid          NOT NULL,
        "projectRoleId"         uuid          NOT NULL,
        "status"                "public"."project_memberships_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "joinedAt"              TIMESTAMP WITH TIME ZONE,
        "removedAt"             TIMESTAMP WITH TIME ZONE,
        "invitedByUserId"       uuid,
        "project_id"            integer       NOT NULL,
        "user_id"               integer       NOT NULL,
        "project_role_id"       integer       NOT NULL,
        "invited_by_user_id"    integer,
        CONSTRAINT "UQ_project_memberships_id"           UNIQUE ("id"),
        CONSTRAINT "UQ_project_memberships_project_user" UNIQUE ("project_id", "user_id"),
        CONSTRAINT "PK_project_memberships"              PRIMARY KEY ("pkid")
      )
    `);

    // ── Project invites ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."project_invites_status_enum"
        AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED')
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."project_invites_targettype_enum"
        AS ENUM('project', 'task', 'subtask')
    `);

    await queryRunner.query(`
      CREATE TABLE "project_invites" (
        "pkid"                SERIAL        NOT NULL,
        "id"                  uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"             integer       NOT NULL DEFAULT '1',
        "createdAt"           TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP     NOT NULL DEFAULT now(),
        "projectId"           uuid          NOT NULL,
        "inviterUserId"       uuid          NOT NULL,
        "inviteeUserId"       uuid,
        "inviteeEmail"        varchar(100)  NOT NULL,
        "projectRoleId"       uuid          NOT NULL,
        "token"               varchar(128)  NOT NULL,
        "status"              "public"."project_invites_status_enum"    NOT NULL DEFAULT 'PENDING',
        "expiresAt"           TIMESTAMP WITH TIME ZONE NOT NULL,
        "acceptedAt"          TIMESTAMP WITH TIME ZONE,
        "taskId"              uuid,
        "subtaskId"           uuid,
        "targetType"          "public"."project_invites_targettype_enum" NOT NULL DEFAULT 'project',
        "targetName"          varchar(200),
        "projectName"         varchar(200),
        "message"             text,
        "autoAssignOnAccept"  boolean       NOT NULL DEFAULT false,
        "project_id"          integer       NOT NULL,
        "inviter_user_id"     integer       NOT NULL,
        "invitee_user_id"     integer,
        "project_role_id"     integer       NOT NULL,
        CONSTRAINT "UQ_project_invites_id"    UNIQUE ("id"),
        CONSTRAINT "UQ_project_invites_token" UNIQUE ("token"),
        CONSTRAINT "PK_project_invites"       PRIMARY KEY ("pkid")
      )
    `);

    // ── Project activity logs ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."project_activity_logs_actiontype_enum"
        AS ENUM(
          'project:created','project:updated','project:archived',
          'member:added','member:removed','member:role_changed',
          'invite:sent','invite:accepted','invite:cancelled','invite:resent',
          'task:created','task:updated','task:deleted','task:moved',
          'task:assigned','task:completed','task:reopened',
          'comment:added','document:uploaded'
        )
    `);

    await queryRunner.query(`
      CREATE TABLE "project_activity_logs" (
        "pkid"         SERIAL        NOT NULL,
        "id"           uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"      integer       NOT NULL DEFAULT '1',
        "createdAt"    TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"    TIMESTAMP     NOT NULL DEFAULT now(),
        "projectId"    uuid          NOT NULL,
        "userId"       uuid,
        "taskId"       uuid,
        "actionType"   "public"."project_activity_logs_actiontype_enum" NOT NULL,
        "actorName"    varchar(200),
        "metadata"     jsonb,
        "project_id"   integer       NOT NULL,
        "user_id"      integer,
        CONSTRAINT "UQ_project_activity_logs_id" UNIQUE ("id"),
        CONSTRAINT "PK_project_activity_logs"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Workflow columns ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "workflow_columns" (
        "pkid"        SERIAL        NOT NULL,
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"     integer       NOT NULL DEFAULT '1',
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "name"        varchar(100)  NOT NULL,
        "statusKey"   varchar(50),
        "orderIndex"  integer       NOT NULL DEFAULT '0',
        "wipLimit"    integer,
        "locked"      boolean       NOT NULL DEFAULT false,
        "projectId"   uuid          NOT NULL,
        "project_id"  integer       NOT NULL,
        CONSTRAINT "UQ_workflow_columns_id" UNIQUE ("id"),
        CONSTRAINT "PK_workflow_columns"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Tasks ─────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."tasks_status_enum"
        AS ENUM('TODO','IN_PROGRESS','IN_REVIEW','DONE','BLOCKED','CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."tasks_priority_enum"
        AS ENUM('LOW','MEDIUM','HIGH','URGENT')
    `);

    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "pkid"              SERIAL        NOT NULL,
        "id"                uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"           integer       NOT NULL DEFAULT '1',
        "createdAt"         TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"         TIMESTAMP     NOT NULL DEFAULT now(),
        "projectId"         uuid          NOT NULL,
        "parentTaskId"      uuid,
        "workflowColumnId"  uuid,
        "title"             varchar(300)  NOT NULL,
        "description"       text,
        "status"            "public"."tasks_status_enum"    NOT NULL DEFAULT 'TODO',
        "priority"          "public"."tasks_priority_enum",
        "startDate"         date,
        "endDate"           date,
        "progress"          integer,
        "completed"         boolean       NOT NULL DEFAULT false,
        "rank"              varchar(50),
        "deletedAt"         TIMESTAMP WITH TIME ZONE,
        "createdByUserId"      uuid          NOT NULL,
        "reporteeUserId"       uuid,
        "project_id"           integer       NOT NULL,
        "parent_task_id"       integer,
        "workflow_column_id"   integer,
        "created_by_user_id"   integer       NOT NULL,
        "reportee_user_id"     integer,
        CONSTRAINT "UQ_tasks_id" UNIQUE ("id"),
        CONSTRAINT "PK_tasks"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Task view metadata ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "task_view_metadata" (
        "pkid"      SERIAL    NOT NULL,
        "id"        uuid      NOT NULL DEFAULT uuid_generate_v4(),
        "version"   integer   NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "taskId"    uuid      NOT NULL,
        "viewType" varchar(50) NOT NULL,
        "meta"     jsonb     NOT NULL DEFAULT '{}',
        "task_id"  integer   NOT NULL,
        CONSTRAINT "UQ_task_view_metadata_id"           UNIQUE ("id"),
        CONSTRAINT "UQ_task_view_metadata_task_viewtype" UNIQUE ("task_id", "viewType"),
        CONSTRAINT "PK_task_view_metadata"               PRIMARY KEY ("pkid")
      )
    `);

    // ── Task assignees ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."task_assignees_assignmentrole_enum"
        AS ENUM('ASSIGNEE','REPORTER')
    `);

    await queryRunner.query(`
      CREATE TABLE "task_assignees" (
        "pkid"              SERIAL        NOT NULL,
        "id"                uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"           integer       NOT NULL DEFAULT 1,
        "createdAt"         TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"         TIMESTAMP     NOT NULL DEFAULT now(),
        "taskId"            uuid          NOT NULL,
        "userId"            uuid          NOT NULL,
        "projectRoleId"     uuid,
        "assignmentRole"    "public"."task_assignees_assignmentrole_enum" NOT NULL DEFAULT 'ASSIGNEE',
        "task_id"           integer       NOT NULL,
        "user_id"           integer       NOT NULL,
        "project_role_id"   integer,
        CONSTRAINT "UQ_task_assignees_id"        UNIQUE ("id"),
        CONSTRAINT "UQ_task_assignees_task_user_role" UNIQUE ("task_id", "user_id", "assignmentRole"),
        CONSTRAINT "PK_task_assignees"           PRIMARY KEY ("pkid")
      )
    `);

    // ── Task checklist items ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "task_checklist_items" (
        "pkid"               SERIAL       NOT NULL,
        "id"                 uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "version"            integer      NOT NULL DEFAULT 1,
        "createdAt"          TIMESTAMP    NOT NULL DEFAULT now(),
        "updatedAt"          TIMESTAMP    NOT NULL DEFAULT now(),
        "taskId"             uuid         NOT NULL,
        "text"               varchar(500) NOT NULL,
        "completed"          boolean      NOT NULL DEFAULT false,
        "orderIndex"         integer      NOT NULL DEFAULT '0',
        "completedByUserId"  uuid,
        "completedAt"        TIMESTAMP WITH TIME ZONE,
        "task_id"            integer      NOT NULL,
        "completed_by_id"    integer,
        CONSTRAINT "UQ_task_checklist_items_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_checklist_items"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Task comments ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "task_comments" (
        "pkid"            SERIAL    NOT NULL,
        "id"              uuid      NOT NULL DEFAULT uuid_generate_v4(),
        "version"         integer   NOT NULL DEFAULT 1,
        "taskId"          uuid      NOT NULL,
        "authorUserId"    uuid      NOT NULL,
        "body"            text      NOT NULL,
        "parentCommentId" uuid,
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "task_id"         integer   NOT NULL,
        "author_id"       integer   NOT NULL,
        "parent_comment_id" integer,
        CONSTRAINT "UQ_task_comments_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_comments"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Task dependencies ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."task_dependencies_dependencytype_enum"
        AS ENUM('FS','SS','FF','SF')
    `);

    await queryRunner.query(`
      CREATE TABLE "task_dependencies" (
        "pkid"             SERIAL    NOT NULL,
        "id"               uuid      NOT NULL DEFAULT uuid_generate_v4(),
        "version"          integer   NOT NULL DEFAULT 1,
        "createdAt"        TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP NOT NULL DEFAULT now(),
        "taskId"           uuid      NOT NULL,
        "dependsOnTaskId"  uuid      NOT NULL,
        "dependencyType"   "public"."task_dependencies_dependencytype_enum" NOT NULL DEFAULT 'FS',
        "lagDays"          integer,
        "task_id"          integer   NOT NULL,
        "depends_on_id"    integer   NOT NULL,
        CONSTRAINT "UQ_task_dependencies_id"        UNIQUE ("id"),
        CONSTRAINT "UQ_task_dependencies_task_deps" UNIQUE ("task_id", "depends_on_id"),
        CONSTRAINT "PK_task_dependencies"           PRIMARY KEY ("pkid")
      )
    `);

    // ── Task activity logs ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."task_activity_logs_actiontype_enum"
        AS ENUM(
          'task:created','task:updated','task:deleted','task:status_changed',
          'task:assigned','task:unassigned','task:moved','task:completed',
          'task:reopened','comment:added','checklist:toggled','attachment:added'
        )
    `);

    await queryRunner.query(`
      CREATE TABLE "task_activity_logs" (
        "pkid"       SERIAL    NOT NULL,
        "id"         uuid      NOT NULL DEFAULT uuid_generate_v4(),
        "version"    integer   NOT NULL DEFAULT 1,
        "taskId"     uuid      NOT NULL,
        "userId"     uuid,
        "actionType" "public"."task_activity_logs_actiontype_enum" NOT NULL,
        "actorName"  varchar(200),
        "metadata"   jsonb,
        "createdAt"  TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"  TIMESTAMP NOT NULL DEFAULT now(),
        "task_id"    integer   NOT NULL,
        "user_id"    integer,
        CONSTRAINT "UQ_task_activity_logs_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_activity_logs"    PRIMARY KEY ("pkid")
      )
    `);

    // ── Foreign key constraints ───────────────────────────────────────────────

    // users
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_users_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("pkid") ON DELETE SET NULL`);
    // user_profiles
    await queryRunner.query(`ALTER TABLE "user_profiles" ADD CONSTRAINT "FK_user_profiles_user" FOREIGN KEY ("user_id") REFERENCES "users"("pkid") ON DELETE CASCADE`);
    // user_sessions
    await queryRunner.query(`ALTER TABLE "user_sessions" ADD CONSTRAINT "FK_user_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("pkid") ON DELETE CASCADE`);
    // audit_logs
    await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_audit_logs_actor" FOREIGN KEY ("actor_id") REFERENCES "users"("pkid") ON DELETE SET NULL`);
    // workspace_roles
    await queryRunner.query(`ALTER TABLE "workspace_roles" ADD CONSTRAINT "FK_workspace_roles_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("pkid") ON DELETE CASCADE`);
    // workspace_members
    await queryRunner.query(`ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_workspace_members_workspace"    FOREIGN KEY ("workspace_id")       REFERENCES "workspaces"("pkid")       ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_workspace_members_user"         FOREIGN KEY ("user_id")            REFERENCES "users"("pkid")            ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_workspace_members_role"         FOREIGN KEY ("workspace_role_id")  REFERENCES "workspace_roles"("pkid")  ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "workspace_members" ADD CONSTRAINT "FK_workspace_members_invited_by"   FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("pkid")            ON DELETE SET NULL`);
    // templates
    await queryRunner.query(`ALTER TABLE "templates" ADD CONSTRAINT "FK_templates_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("pkid") ON DELETE CASCADE`);
    // template_tasks
    await queryRunner.query(`ALTER TABLE "template_tasks" ADD CONSTRAINT "FK_template_tasks_template"    FOREIGN KEY ("template_id")    REFERENCES "templates"("pkid")      ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "template_tasks" ADD CONSTRAINT "FK_template_tasks_parent"      FOREIGN KEY ("parent_task_id") REFERENCES "template_tasks"("pkid") ON DELETE CASCADE`);
    // project_roles
    await queryRunner.query(`ALTER TABLE "project_roles" ADD CONSTRAINT "FK_project_roles_project" FOREIGN KEY ("project_id") REFERENCES "projects"("pkid") ON DELETE CASCADE`);
    // projects
    await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "FK_projects_workspace"   FOREIGN KEY ("workspace_id")  REFERENCES "workspaces"("pkid") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "FK_projects_template"    FOREIGN KEY ("template_id")   REFERENCES "templates"("pkid")  ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "FK_projects_created_by"  FOREIGN KEY ("created_by_id") REFERENCES "users"("pkid")       ON DELETE RESTRICT`);
    // project_memberships
    await queryRunner.query(`ALTER TABLE "project_memberships" ADD CONSTRAINT "FK_project_memberships_project"     FOREIGN KEY ("project_id")      REFERENCES "projects"("pkid")       ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "project_memberships" ADD CONSTRAINT "FK_project_memberships_user"        FOREIGN KEY ("user_id")         REFERENCES "users"("pkid")          ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "project_memberships" ADD CONSTRAINT "FK_project_memberships_role"        FOREIGN KEY ("project_role_id") REFERENCES "project_roles"("pkid")  ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "project_memberships" ADD CONSTRAINT "FK_project_memberships_invited_by"  FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("pkid")       ON DELETE SET NULL`);
    // project_invites
    await queryRunner.query(`ALTER TABLE "project_invites" ADD CONSTRAINT "FK_project_invites_project"      FOREIGN KEY ("project_id")      REFERENCES "projects"("pkid")       ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "project_invites" ADD CONSTRAINT "FK_project_invites_inviter"      FOREIGN KEY ("inviter_user_id") REFERENCES "users"("pkid")          ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "project_invites" ADD CONSTRAINT "FK_project_invites_invitee"      FOREIGN KEY ("invitee_user_id") REFERENCES "users"("pkid")          ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "project_invites" ADD CONSTRAINT "FK_project_invites_role"         FOREIGN KEY ("project_role_id") REFERENCES "project_roles"("pkid")  ON DELETE RESTRICT`);
    // project_activity_logs
    await queryRunner.query(`ALTER TABLE "project_activity_logs" ADD CONSTRAINT "FK_project_activity_logs_project" FOREIGN KEY ("project_id") REFERENCES "projects"("pkid") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "project_activity_logs" ADD CONSTRAINT "FK_project_activity_logs_user"    FOREIGN KEY ("user_id")    REFERENCES "users"("pkid")    ON DELETE SET NULL`);
    // workflow_columns
    await queryRunner.query(`ALTER TABLE "workflow_columns" ADD CONSTRAINT "FK_workflow_columns_project" FOREIGN KEY ("project_id") REFERENCES "projects"("pkid") ON DELETE CASCADE`);
    // tasks
    await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_project"         FOREIGN KEY ("project_id")        REFERENCES "projects"("pkid")          ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_parent"           FOREIGN KEY ("parent_task_id")    REFERENCES "tasks"("pkid")             ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_workflow_column"  FOREIGN KEY ("workflow_column_id") REFERENCES "workflow_columns"("pkid") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_created_by"       FOREIGN KEY ("created_by_user_id") REFERENCES "users"("pkid")             ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_reportee_user"   FOREIGN KEY ("reportee_user_id")   REFERENCES "users"("pkid")             ON DELETE SET NULL`);
    // task_view_metadata
    await queryRunner.query(`ALTER TABLE "task_view_metadata" ADD CONSTRAINT "FK_task_view_metadata_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("pkid") ON DELETE CASCADE`);
    // task_assignees
    await queryRunner.query(`ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_task_assignees_task"         FOREIGN KEY ("task_id")         REFERENCES "tasks"("pkid")          ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_task_assignees_user"         FOREIGN KEY ("user_id")         REFERENCES "users"("pkid")          ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_task_assignees_project_role" FOREIGN KEY ("project_role_id") REFERENCES "project_roles"("pkid")  ON DELETE SET NULL`);
    // task_checklist_items
    await queryRunner.query(`ALTER TABLE "task_checklist_items" ADD CONSTRAINT "FK_task_checklist_items_task"         FOREIGN KEY ("task_id")        REFERENCES "tasks"("pkid") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "task_checklist_items" ADD CONSTRAINT "FK_task_checklist_items_completed_by" FOREIGN KEY ("completed_by_id") REFERENCES "users"("pkid") ON DELETE SET NULL`);
    // task_comments
    await queryRunner.query(`ALTER TABLE "task_comments" ADD CONSTRAINT "FK_task_comments_task"           FOREIGN KEY ("task_id")           REFERENCES "tasks"("pkid")         ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "task_comments" ADD CONSTRAINT "FK_task_comments_author"         FOREIGN KEY ("author_id")          REFERENCES "users"("pkid")         ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "task_comments" ADD CONSTRAINT "FK_task_comments_parent_comment" FOREIGN KEY ("parent_comment_id")  REFERENCES "task_comments"("pkid") ON DELETE CASCADE`);
    // task_dependencies
    await queryRunner.query(`ALTER TABLE "task_dependencies" ADD CONSTRAINT "FK_task_dependencies_task"       FOREIGN KEY ("task_id")       REFERENCES "tasks"("pkid") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "task_dependencies" ADD CONSTRAINT "FK_task_dependencies_depends_on" FOREIGN KEY ("depends_on_id") REFERENCES "tasks"("pkid") ON DELETE CASCADE`);
    // task_activity_logs
    await queryRunner.query(`ALTER TABLE "task_activity_logs" ADD CONSTRAINT "FK_task_activity_logs_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("pkid") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "task_activity_logs" ADD CONSTRAINT "FK_task_activity_logs_user" FOREIGN KEY ("user_id") REFERENCES "users"("pkid") ON DELETE SET NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse dependency order
    await queryRunner.query(`ALTER TABLE "task_activity_logs"   DROP CONSTRAINT IF EXISTS "FK_task_activity_logs_user"`);
    await queryRunner.query(`ALTER TABLE "task_activity_logs"   DROP CONSTRAINT IF EXISTS "FK_task_activity_logs_task"`);
    await queryRunner.query(`ALTER TABLE "task_dependencies"    DROP CONSTRAINT IF EXISTS "FK_task_dependencies_depends_on"`);
    await queryRunner.query(`ALTER TABLE "task_dependencies"    DROP CONSTRAINT IF EXISTS "FK_task_dependencies_task"`);
    await queryRunner.query(`ALTER TABLE "task_comments"        DROP CONSTRAINT IF EXISTS "FK_task_comments_parent_comment"`);
    await queryRunner.query(`ALTER TABLE "task_comments"        DROP CONSTRAINT IF EXISTS "FK_task_comments_author"`);
    await queryRunner.query(`ALTER TABLE "task_comments"        DROP CONSTRAINT IF EXISTS "FK_task_comments_task"`);
    await queryRunner.query(`ALTER TABLE "task_checklist_items" DROP CONSTRAINT IF EXISTS "FK_task_checklist_items_completed_by"`);
    await queryRunner.query(`ALTER TABLE "task_checklist_items" DROP CONSTRAINT IF EXISTS "FK_task_checklist_items_task"`);
    await queryRunner.query(`ALTER TABLE "task_assignees"       DROP CONSTRAINT IF EXISTS "FK_task_assignees_project_role"`);
    await queryRunner.query(`ALTER TABLE "task_assignees"       DROP CONSTRAINT IF EXISTS "FK_task_assignees_user"`);
    await queryRunner.query(`ALTER TABLE "task_assignees"       DROP CONSTRAINT IF EXISTS "FK_task_assignees_task"`);
    await queryRunner.query(`ALTER TABLE "task_view_metadata"   DROP CONSTRAINT IF EXISTS "FK_task_view_metadata_task"`);
    await queryRunner.query(`ALTER TABLE "tasks"                DROP CONSTRAINT IF EXISTS "FK_tasks_created_by"`);
    await queryRunner.query(`ALTER TABLE "tasks"                DROP CONSTRAINT IF EXISTS "FK_tasks_workflow_column"`);
    await queryRunner.query(`ALTER TABLE "tasks"                DROP CONSTRAINT IF EXISTS "FK_tasks_parent"`);
    await queryRunner.query(`ALTER TABLE "tasks"                DROP CONSTRAINT IF EXISTS "FK_tasks_project"`);
    await queryRunner.query(`ALTER TABLE "workflow_columns"     DROP CONSTRAINT IF EXISTS "FK_workflow_columns_project"`);
    await queryRunner.query(`ALTER TABLE "project_activity_logs" DROP CONSTRAINT IF EXISTS "FK_project_activity_logs_user"`);
    await queryRunner.query(`ALTER TABLE "project_activity_logs" DROP CONSTRAINT IF EXISTS "FK_project_activity_logs_project"`);
    await queryRunner.query(`ALTER TABLE "project_invites"      DROP CONSTRAINT IF EXISTS "FK_project_invites_role"`);
    await queryRunner.query(`ALTER TABLE "project_invites"      DROP CONSTRAINT IF EXISTS "FK_project_invites_invitee"`);
    await queryRunner.query(`ALTER TABLE "project_invites"      DROP CONSTRAINT IF EXISTS "FK_project_invites_inviter"`);
    await queryRunner.query(`ALTER TABLE "project_invites"      DROP CONSTRAINT IF EXISTS "FK_project_invites_project"`);
    await queryRunner.query(`ALTER TABLE "project_memberships"  DROP CONSTRAINT IF EXISTS "FK_project_memberships_invited_by"`);
    await queryRunner.query(`ALTER TABLE "project_memberships"  DROP CONSTRAINT IF EXISTS "FK_project_memberships_role"`);
    await queryRunner.query(`ALTER TABLE "project_memberships"  DROP CONSTRAINT IF EXISTS "FK_project_memberships_user"`);
    await queryRunner.query(`ALTER TABLE "project_memberships"  DROP CONSTRAINT IF EXISTS "FK_project_memberships_project"`);
    await queryRunner.query(`ALTER TABLE "projects"             DROP CONSTRAINT IF EXISTS "FK_projects_created_by"`);
    await queryRunner.query(`ALTER TABLE "projects"             DROP CONSTRAINT IF EXISTS "FK_projects_template"`);
    await queryRunner.query(`ALTER TABLE "projects"             DROP CONSTRAINT IF EXISTS "FK_projects_workspace"`);
    await queryRunner.query(`ALTER TABLE "project_roles"        DROP CONSTRAINT IF EXISTS "FK_project_roles_project"`);
    await queryRunner.query(`ALTER TABLE "template_tasks"       DROP CONSTRAINT IF EXISTS "FK_template_tasks_parent"`);
    await queryRunner.query(`ALTER TABLE "template_tasks"       DROP CONSTRAINT IF EXISTS "FK_template_tasks_template"`);
    await queryRunner.query(`ALTER TABLE "templates"            DROP CONSTRAINT IF EXISTS "FK_templates_workspace"`);
    await queryRunner.query(`ALTER TABLE "workspace_members"    DROP CONSTRAINT IF EXISTS "FK_workspace_members_invited_by"`);
    await queryRunner.query(`ALTER TABLE "workspace_members"    DROP CONSTRAINT IF EXISTS "FK_workspace_members_role"`);
    await queryRunner.query(`ALTER TABLE "workspace_members"    DROP CONSTRAINT IF EXISTS "FK_workspace_members_user"`);
    await queryRunner.query(`ALTER TABLE "workspace_members"    DROP CONSTRAINT IF EXISTS "FK_workspace_members_workspace"`);
    await queryRunner.query(`ALTER TABLE "workspace_roles"      DROP CONSTRAINT IF EXISTS "FK_workspace_roles_workspace"`);
    await queryRunner.query(`ALTER TABLE "audit_logs"           DROP CONSTRAINT IF EXISTS "FK_audit_logs_actor"`);
    await queryRunner.query(`ALTER TABLE "user_sessions"        DROP CONSTRAINT IF EXISTS "FK_user_sessions_user"`);
    await queryRunner.query(`ALTER TABLE "user_profiles"        DROP CONSTRAINT IF EXISTS "FK_user_profiles_user"`);
    await queryRunner.query(`ALTER TABLE "users"                DROP CONSTRAINT IF EXISTS "FK_users_created_by"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "task_activity_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_dependencies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_checklist_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_assignees"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_view_metadata"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_columns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_activity_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_invites"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_memberships"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "projects"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "template_tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "templates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_profiles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workspaces"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "public"."task_activity_logs_actiontype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."task_dependencies_dependencytype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."task_assignees_assignmentrole_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."tasks_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."tasks_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."project_activity_logs_actiontype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."project_invites_targettype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."project_invites_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."project_memberships_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."projects_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."projects_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."workspace_members_status_enum"`);
  }
}
