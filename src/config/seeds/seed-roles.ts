/**
 * Seed: Default Roles
 *
 * Creates three standard roles for EVERY organisation that does not already
 * have them.  The roles are:
 *
 *   admin   — Full access (created by seed-admin; this seed skips it if present)
 *   manager — Creates/manages projects, tasks, templates; cannot manage
 *             users or roles directly
 *   member  — Can view and contribute to projects and tasks; read-only on
 *             templates; no user/role management
 *   viewer  — Read-only across all domains
 *
 * Safe to re-run — checks for existing slugs before inserting.
 *
 * Usage:  npm run seed:roles
 *         (automatically called by:  npm run seed:all)
 *
 * Required env vars (from .env):
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
 */
import 'reflect-metadata';
import { config as dotenvConfig } from 'dotenv';
import { DataSource } from 'typeorm';

dotenvConfig({ path: '.env' });

import { dataSourceOptions } from '../db/db.config';
import { Organization } from '../../organizations/entities/organization.entity';
import { Role } from '../../roles/roles.entity';
import { PermissionMatrix } from '../../roles/types/permission-matrix.type';

// ── Permission presets ────────────────────────────────────────────────────────

/**
 * Manager: full CRUD on project/task/template/document work;
 * can view (but not manage) users/roles.
 */
const MANAGER_PERMISSIONS: PermissionMatrix = {
  projectManagement: { create: true, update: true, view: true, delete: true },
  changeRequestManagement: {
    create: true,
    update: true,
    view: true,
    delete: true,
  },
  taskManagement: { create: true, update: true, view: true, delete: true },
  documentManagement: { create: true, update: true, view: true, delete: true },
  userManagement: { create: false, update: false, view: true, delete: false },
  roleManagement: { create: false, update: false, view: true, delete: false },
  templateManagement: { create: true, update: true, view: true, delete: false },
};

/**
 * Member: can view and contribute to projects/tasks; read-only templates;
 * no user, role, or document management.
 */
const MEMBER_PERMISSIONS: PermissionMatrix = {
  projectManagement: { create: false, update: true, view: true, delete: false },
  changeRequestManagement: {
    create: false,
    update: false,
    view: true,
    delete: false,
  },
  taskManagement: { create: true, update: true, view: true, delete: false },
  documentManagement: {
    create: false,
    update: false,
    view: true,
    delete: false,
  },
  userManagement: { create: false, update: false, view: false, delete: false },
  roleManagement: { create: false, update: false, view: false, delete: false },
  templateManagement: {
    create: false,
    update: false,
    view: true,
    delete: false,
  },
};

/**
 * Viewer: read-only across all domains; cannot create or modify anything.
 */
const VIEWER_PERMISSIONS: PermissionMatrix = {
  projectManagement: {
    create: false,
    update: false,
    view: true,
    delete: false,
  },
  changeRequestManagement: {
    create: false,
    update: false,
    view: true,
    delete: false,
  },
  taskManagement: { create: false, update: false, view: true, delete: false },
  documentManagement: {
    create: false,
    update: false,
    view: true,
    delete: false,
  },
  userManagement: { create: false, update: false, view: false, delete: false },
  roleManagement: { create: false, update: false, view: false, delete: false },
  templateManagement: {
    create: false,
    update: false,
    view: true,
    delete: false,
  },
};

// ── Default roles definition ──────────────────────────────────────────────────

const DEFAULT_ROLES: Array<{
  name: string;
  slug: string;
  permissions: PermissionMatrix;
}> = [
  { name: 'Manager', slug: 'manager', permissions: MANAGER_PERMISSIONS },
  { name: 'Member', slug: 'member', permissions: MEMBER_PERMISSIONS },
  { name: 'Viewer', slug: 'viewer', permissions: VIEWER_PERMISSIONS },
];

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seedRoles(): Promise<void> {
  const ds = new DataSource({
    ...(dataSourceOptions as any),
    synchronize: false,
  });
  await ds.initialize();

  const orgRepo = ds.getRepository(Organization);
  const roleRepo = ds.getRepository(Role);

  const organisations = await orgRepo.find();

  if (organisations.length === 0) {
    console.log('\n⚠️  No organisations found — run seed:admin first.\n');
    await ds.destroy();
    return;
  }

  console.log(
    `\n🌱  Seeding default roles for ${organisations.length} organisation(s)…\n`,
  );

  let created = 0;
  let skipped = 0;

  for (const org of organisations) {
    for (const def of DEFAULT_ROLES) {
      const existing = await roleRepo.findOne({
        where: { slug: def.slug, organizationId: org.id },
      });

      if (existing) {
        console.log(
          `  ⏭  [${org.name}] "${def.name}" (${def.slug}) already exists — skipping.`,
        );
        skipped++;
        continue;
      }

      const role = roleRepo.create({
        name: def.name,
        slug: def.slug,
        status: true,
        permissions: def.permissions,
        organization: org,
        organizationId: org.id,
      });

      await roleRepo.save(role);
      console.log(
        `  ✓  [${org.name}] Created role "${def.name}" (${def.slug})`,
      );
      created++;
    }
  }

  await ds.destroy();

  console.log(
    `\n✅ Default-roles seed complete: ${created} created, ${skipped} skipped.\n`,
  );
}

seedRoles().catch((err: Error) => {
  console.error('\n❌ Role seed failed:', err.message, '\n', err.stack);
  process.exit(1);
});
