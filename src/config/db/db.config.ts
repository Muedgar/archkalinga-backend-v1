import { config as dotenvConfig } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

dotenvConfig({ path: '.env' });

const isTsRuntime = __filename.endsWith('.ts');
const entitiesPath = isTsRuntime
  ? ['src/**/*.entity.ts']
  : ['dist/**/*.entity.js'];
const migrationsPath = isTsRuntime
  ? ['src/migrations/*.ts']
  : ['dist/migrations/*.js'];

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

const hostCandidate = process.env.POSTGRES_HOST || process.env.PGHOST;
const hostLooksLikeUrl =
  typeof hostCandidate === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(hostCandidate);

// Prefer full URLs when available. Also recover from misconfigured host vars
// that accidentally contain a full postgres connection string.
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  (hostLooksLikeUrl ? hostCandidate : undefined);

const host = hostLooksLikeUrl ? undefined : hostCandidate;
const port = Number(process.env.POSTGRES_PORT || process.env.PGPORT || 5432);
const username = process.env.POSTGRES_USER || process.env.PGUSER;
const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD;
const database = process.env.POSTGRES_DB || process.env.PGDATABASE;

export const dataSourceOptions: DataSourceOptions = dbUrl
  ? {
      type: 'postgres',
      url: dbUrl,
      entities: entitiesPath,
      migrations: migrationsPath,
      synchronize: false,
      logging: false,
      ssl: isProduction ? false : { rejectUnauthorized: false },
    }
  : {
      type: 'postgres',
      host,
      port,
      username,
      password,
      database,
      entities: entitiesPath,
      migrations: migrationsPath,
      synchronize: false,
      logging: false,
      ssl: false,
      // poolSize: Number(process.env.POSTGRES_POOL_SIZE),
    };

export const dataSource = new DataSource(
  dataSourceOptions as DataSourceOptions,
);
