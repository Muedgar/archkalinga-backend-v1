import 'reflect-metadata';
import { config as dotenvConfig } from 'dotenv';
import { DataSource } from 'typeorm';

dotenvConfig({ path: '.env' });

import { dataSourceOptions } from '../db/db.config';
import { Project, ProjectRole } from '../../projects/entities';
import { DEFAULT_PROJECT_ROLE_DEFINITIONS } from '../../projects/constants';

async function seedProjectRoles(): Promise<void> {
  const ds = new DataSource({ ...(dataSourceOptions as any), synchronize: false });
  await ds.initialize();

  const projectRepo = ds.getRepository(Project);
  const roleRepo = ds.getRepository(ProjectRole);

  const projects = await projectRepo.find();

  if (projects.length === 0) {
    console.log('\n⚠️  No projects found — skipping project-role backfill.\n');
    await ds.destroy();
    return;
  }

  console.log(
    `\n🌱  Backfilling starter project roles for ${projects.length} project(s)…\n`,
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const project of projects) {
    await ds.transaction(async (tx) => {
      const existingRoles = await tx.find(ProjectRole, {
        where: { projectId: project.id },
      });

      const roleMap = new Map(existingRoles.map((role) => [role.slug, role]));
      const legacyManagerRole = roleMap.get('project-admin');
      const managerRole = roleMap.get('manager');

      if (legacyManagerRole && !managerRole) {
        legacyManagerRole.slug = 'manager';
        legacyManagerRole.name = 'Manager';
        legacyManagerRole.isSystem = true;
        legacyManagerRole.isProtected = false;
        await tx.save(legacyManagerRole);
        roleMap.delete('project-admin');
        roleMap.set('manager', legacyManagerRole);
        updated++;
      }

      for (const def of DEFAULT_PROJECT_ROLE_DEFINITIONS) {
        const existing = roleMap.get(def.slug);

        if (existing) {
          let changed = false;

          if (existing.isSystem !== def.isSystem) {
            existing.isSystem = def.isSystem;
            changed = true;
          }

          if (existing.isProtected !== def.isProtected) {
            existing.isProtected = def.isProtected;
            changed = true;
          }

          if (changed) {
            await tx.save(existing);
            updated++;
          } else {
            skipped++;
          }
          continue;
        }

        const createdRole = tx.create(ProjectRole, {
          projectId: project.id,
          name: def.name,
          slug: def.slug,
          status: true,
          isSystem: def.isSystem,
          isProtected: def.isProtected,
          permissions: def.permissions,
        });

        await tx.save(createdRole);
        roleMap.set(def.slug, createdRole);
        created++;
      }
    });
  }

  await ds.destroy();

  console.log(
    `\n✅ Project-role seed complete: ${created} created, ${updated} updated, ${skipped} unchanged.\n`,
  );
}

seedProjectRoles().catch((err: Error) => {
  console.error('\n❌ Project-role seed failed:', err.message, '\n', err.stack);
  process.exit(1);
});
