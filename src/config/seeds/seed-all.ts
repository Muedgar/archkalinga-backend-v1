/**
 * Seed: All
 *
 * Orchestrates every seed script in the correct order for a fresh
 * ArchKalinga installation.  Also safe to re-run — each seed is
 * individually idempotent.
 *
 * Usage:  npm run seed:all
 *         (or as part of:  npm run db:fresh)
 *
 * Execution order
 * ---------------
 *  1. seed-admin             — org + admin role (FULL_ACCESS_MATRIX) + super-admin user
 *  2. seed-roles             — Manager / Member / Viewer default roles per org
 *  3. seed-permissions-patch — backfills any missing permission domains into ALL
 *                              existing roles so no role is left with a stale matrix
 *  4. seed-project-roles     — backfills starter project roles into every project
 *
 * Add future seeds at the end of the SEEDS array in dependency order.
 */
import { execSync } from 'child_process';

const SEEDS: { label: string; script: string }[] = [
  {
    label: 'Admin user',
    script: 'src/config/seeds/seed-admin.ts',
  },
  {
    label: 'Default roles (Manager / Member / Viewer)',
    script: 'src/config/seeds/seed-roles.ts',
  },
  {
    label: 'Permissions patch (backfill missing domains)',
    script: 'src/config/seeds/seed-permissions-patch.ts',
  },
  {
    label:
      'Starter project roles (Owner / Manager / Contributor / Reviewer / Viewer)',
    script: 'src/config/seeds/seed-project-roles.ts',
  },
  // Add future seeds here in dependency order, e.g.:
  // { label: 'Default templates', script: 'src/config/seeds/seed-templates.ts' },
];

const runner = 'ts-node -r tsconfig-paths/register';

console.log('\n🌱 Running all ArchKalinga seeds…\n');

for (const seed of SEEDS) {
  console.log(`▶  ${seed.label}  (${seed.script})`);
  try {
    execSync(`${runner} ${seed.script}`, { stdio: 'inherit' });
  } catch {
    console.error(`\n❌ Seed failed: ${seed.label}. Aborting.\n`);
    process.exit(1);
  }
}

console.log('\n✅ All seeds completed successfully.\n');
