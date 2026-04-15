/**
 * Seed: Permissions
 *
 * Seeds the global `permissions` table with all domain + action combinations.
 * Permissions are resource-specific and workspace/user agnostic.
 * This script is idempotent — safe to re-run after adding new domains.
 *
 * Usage:  npm run seed:permissions
 *         (also called as part of:  npm run seed:all)
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../db/db.config';
import { Permission } from 'src/permissions/permission.entity';

const PERMISSION_DOMAINS: { domain: string; description: string }[] = [
  { domain: 'userManagement',          description: 'Manage workspace collaborators' },
  { domain: 'roleManagement',          description: 'Manage workspace roles and their permission matrices' },
  { domain: 'templateManagement',      description: 'Manage project templates' },
  { domain: 'projectManagement',       description: 'Create and manage projects' },
  { domain: 'taskManagement',          description: 'Create and manage tasks within a project' },
  { domain: 'documentManagement',      description: 'Upload and manage project documents' },
  { domain: 'changeRequestManagement', description: 'Create and review change requests' },
];

const ACTIONS: { action: string; suffix: string }[] = [
  { action: 'create', suffix: 'Create new records' },
  { action: 'update', suffix: 'Edit existing records' },
  { action: 'view',   suffix: 'Read / list records' },
  { action: 'delete', suffix: 'Remove records' },
];

async function run() {
  const dataSource = new DataSource({
    ...(dataSourceOptions as any),
    entities: [Permission],
  });

  await dataSource.initialize();
  const repo = dataSource.getRepository(Permission);

  console.log('\n🔐 Seeding global permissions…\n');

  let created = 0;
  let skipped = 0;

  for (const { domain, description } of PERMISSION_DOMAINS) {
    for (const { action, suffix } of ACTIONS) {
      const existing = await repo.findOne({ where: { domain, action } });
      if (existing) {
        skipped++;
        continue;
      }

      await repo.save(
        repo.create({
          domain,
          action,
          description: `${description} — ${suffix}`,
        }),
      );
      created++;
      console.log(`  ✅  ${domain}.${action}`);
    }
  }

  console.log(`\nDone. Created: ${created}  Skipped (already existed): ${skipped}\n`);
  await dataSource.destroy();
}

run().catch((err) => {
  console.error('❌ Permission seed failed:', err);
  process.exit(1);
});
