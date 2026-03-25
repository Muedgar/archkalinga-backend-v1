/**
 * Seed: All
 *
 * Orchestrates every seed script in the correct order for a fresh
 * ArchKalinga installation.
 *
 * Usage:  npm run seed:all
 *         (or as part of:  npm run db:fresh)
 */
import { execSync } from 'child_process';

const SEEDS: { label: string; script: string }[] = [
  {
    label: 'Admin user',
    script: 'src/config/seeds/seed-admin.ts',
  },
  // Add future seeds here in order, e.g.:
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
