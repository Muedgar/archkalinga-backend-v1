/**
 * Seed: All
 *
 * Orchestrates every seed script in the correct order for a fresh
 * ArchKalinga workspace installation.  Also safe to re-run — each seed is
 * individually idempotent.
 *
 * Usage:  npm run seed:all
 *         (or as part of:  npm run db:fresh)
 *
 * Execution order
 * ---------------
 *  1. seed-permissions — global permission catalogue (7 domains × 4 actions)
 *
 * Add future seeds at the end of the SEEDS array in dependency order.
 */
import { execSync } from 'child_process';

const SEEDS: { label: string; script: string }[] = [
  {
    label: 'Global permissions catalogue',
    script: 'src/config/seeds/seed-permissions.ts',
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
