/**
 * Seed: Initial Admin
 *
 * Creates the first Organization + Admin Role + Super-Admin User for a fresh
 * ArchKalinga installation. Safe to re-run — skips if the admin email already
 * exists.
 *
 * Usage:  npm run seed:admin
 *
 * Required env vars (from .env):
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
 *   SEED_ADMIN_EMAIL      — email for the seeded super-admin (default: admin@archkalinga.com)
 *   SEED_ADMIN_FIRST_NAME — first name (default: Super)
 *   SEED_ADMIN_LAST_NAME  — last name  (default: Admin)
 *   SEED_PASSWORD_PLAIN   — plaintext password to hash and store
 */
import 'reflect-metadata';
import { config as dotenvConfig } from 'dotenv';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';

dotenvConfig({ path: '.env' });

// ── Inline entity references (avoids circular-import issues in seed context) ─
import { dataSourceOptions } from '../db/db.config';
import { Organization } from '../../organizations/entities/organization.entity';
import { Role } from '../../roles/roles.entity';
import { User, UserType } from '../../users/entities/user.entity';
import { UserProfile } from '../../users/entities/user-profile.entity';
import { FULL_ACCESS_MATRIX } from '../../roles/types/permission-matrix.type';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@archkalinga.com';
const ADMIN_FIRST = process.env.SEED_ADMIN_FIRST_NAME ?? 'Super';
const ADMIN_LAST = process.env.SEED_ADMIN_LAST_NAME ?? 'Admin';
const PLAIN_PASSWORD = process.env.SEED_PASSWORD_PLAIN;

if (!PLAIN_PASSWORD) {
  console.error(
    '\n❌ SEED_PASSWORD_PLAIN is not set in .env. Aborting seed.\n',
  );
  process.exit(1);
}

async function seedAdmin(): Promise<void> {
  const ds = new DataSource({
    ...(dataSourceOptions as any),
    synchronize: false,
  });
  await ds.initialize();

  const orgRepo = ds.getRepository(Organization);
  const roleRepo = ds.getRepository(Role);
  const userRepo = ds.getRepository(User);
  const profileRepo = ds.getRepository(UserProfile);

  // ── Guard: skip if admin email already exists ──────────────────────────────
  const existing = await userRepo.findOne({ where: { email: ADMIN_EMAIL } });
  if (existing) {
    console.log(
      `\n⚠️  Admin user "${ADMIN_EMAIL}" already exists — skipping seed.\n`,
    );
    await ds.destroy();
    return;
  }

  await ds.transaction(async (em) => {
    // 1. Organization ──────────────────────────────────────────────────────────
    const org = em.create(Organization, { name: 'ArchKalinga' });
    const savedOrg = await em.save(org);
    // Reload so the database-generated `id` (uuid_generate_v4) is available
    const orgRecord = await em.findOneOrFail(Organization, {
      where: { pkid: savedOrg.pkid },
    });
    console.log(
      `  ✓ Organization created: "${orgRecord.name}" (${orgRecord.id})`,
    );

    // 2. Admin Role (full access) ──────────────────────────────────────────────
    // Always set the relation object — TypeORM's FK column is "owned" by the
    // @ManyToOne relation inside a transaction manager, so the scalar ID alone
    // is silently ignored when building the INSERT.
    const role = em.create(Role, {
      name: 'Admin',
      slug: 'admin',
      status: true,
      organization: orgRecord, // ← relation object (resolves FK)
      organizationId: orgRecord.id,
      permissions: FULL_ACCESS_MATRIX,
    });
    const savedRole = await em.save(role);
    const roleRecord = await em.findOneOrFail(Role, {
      where: { pkid: savedRole.pkid },
    });
    console.log(`  ✓ Role created: "${roleRecord.name}" (${roleRecord.id})`);

    // 3. User ──────────────────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(PLAIN_PASSWORD!, 12);
    const user = em.create(User, {
      firstName: ADMIN_FIRST,
      lastName: ADMIN_LAST,
      userName: `${ADMIN_FIRST.toLowerCase()}.${ADMIN_LAST.toLowerCase()}`,
      email: ADMIN_EMAIL,
      password: passwordHash,
      userType: UserType.ORGANIZATION,
      status: true,
      isDefaultPassword: true,
      emailVerified: true,
      organization: orgRecord, // ← relation object
      organizationId: orgRecord.id,
      role: roleRecord, // ← relation object
      roleId: roleRecord.id,
    });
    const savedUser = await em.save(user);
    const userRecord = await em.findOneOrFail(User, {
      where: { pkid: savedUser.pkid },
    });
    console.log(`  ✓ User created: "${userRecord.email}" (${userRecord.id})`);

    // 4. UserProfile ───────────────────────────────────────────────────────────
    const profile = em.create(UserProfile, {
      user: userRecord, // ← relation object
      userId: userRecord.id,
      profession: null,
      specialty: null,
      bio: null,
    });
    await em.save(profile);
    console.log(`  ✓ UserProfile created for user ${userRecord.id}`);
  });

  await ds.destroy();

  console.log(`
✅ Seed complete!

   Email:    ${ADMIN_EMAIL}
   Password: ${PLAIN_PASSWORD}

   ⚠️  Change this password after first login.
`);
}

seedAdmin().catch((err: Error) => {
  console.error('\n❌ Seed failed:', err.message, '\n', err.stack);
  process.exit(1);
});
