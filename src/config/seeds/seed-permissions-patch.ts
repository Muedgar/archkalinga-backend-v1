/**
 * Seed: Patch Permissions
 *
 * Idempotent script that ensures every role in every organisation has
 * an entry for ALL permission domains defined in PERMISSION_DOMAINS.
 *
 * Why this is needed
 * ------------------
 * Permissions are stored as JSONB. When a new domain is added to the
 * TypeScript permission-matrix (e.g. `inviteManagement`), roles that
 * were created before that domain existed will be missing the key.
 * PermissionGuard checks `matrix?.[domain]?.[action]` — a missing key
 * evaluates as `undefined` (falsy) and blocks access.
 *
 * Strategy
 * ---------
 *   • Admin roles (slug = 'admin') → missing domains get ALL FOUR actions
 *     set to TRUE  (full access preserved for admins).
 *   • All other roles              → missing domains get ALL FOUR actions
 *     set to FALSE (safe default — role owner can grant them later).
 *   • Domains that are already present are left untouched.
 *
 * Usage:  npm run seed:patch-permissions
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
import { Role } from '../../roles/roles.entity';
import {
  PERMISSION_DOMAINS,
  FULL_ACCESS_MATRIX,
  EMPTY_ACCESS_MATRIX,
  PermissionMatrix,
} from '../../roles/types/permission-matrix.type';

// ── Actions that every domain must have ──────────────────────────────────────
const ALL_ACTIONS = ['create', 'update', 'view', 'delete'] as const;

async function patchPermissions(): Promise<void> {
  const ds = new DataSource({
    ...(dataSourceOptions as any),
    synchronize: false,
  });
  await ds.initialize();

  const roleRepo = ds.getRepository(Role);
  const allRoles = await roleRepo.find();

  if (allRoles.length === 0) {
    console.log('\n⚠️  No roles found — nothing to patch.\n');
    await ds.destroy();
    return;
  }

  console.log(
    `\n🔍  Scanning ${allRoles.length} role(s) across all organisations…\n`,
  );

  let patchCount = 0;

  for (const role of allRoles) {
    const isAdmin = role.slug === 'admin';
    let dirty = false;

    // Clone current permissions so we can mutate safely
    const patched: PermissionMatrix = {
      ...(role.permissions as PermissionMatrix),
    };

    for (const domain of PERMISSION_DOMAINS) {
      if (!patched[domain]) {
        // Domain is missing entirely — fill it in
        patched[domain] = isAdmin
          ? { ...FULL_ACCESS_MATRIX[domain] } // admin → all true
          : { ...EMPTY_ACCESS_MATRIX[domain] }; // others → all false
        dirty = true;
        console.log(
          `  + [${role.slug}] "${role.name}" (org: ${role.organizationId}): ` +
            `added domain "${domain}" → ${isAdmin ? 'FULL' : 'EMPTY'}`,
        );
      } else {
        // Domain exists but might be missing individual action keys
        for (const action of ALL_ACTIONS) {
          if (patched[domain][action] === undefined) {
            patched[domain][action] = isAdmin
              ? FULL_ACCESS_MATRIX[domain][action]
              : EMPTY_ACCESS_MATRIX[domain][action];
            dirty = true;
            console.log(
              `  + [${role.slug}] "${role.name}" (org: ${role.organizationId}): ` +
                `added action "${domain}.${action}" → ${isAdmin}`,
            );
          }
        }
      }
    }

    if (dirty) {
      role.permissions = patched;
      await roleRepo.save(role);
      patchCount++;
    }
  }

  await ds.destroy();

  if (patchCount === 0) {
    console.log(
      '  ✓ All roles already have complete permission matrices — no changes needed.\n',
    );
  } else {
    console.log(`\n✅ Patched ${patchCount} role(s) successfully.\n`);
  }
}

patchPermissions().catch((err: Error) => {
  console.error('\n❌ Permissions patch failed:', err.message, '\n', err.stack);
  process.exit(1);
});
