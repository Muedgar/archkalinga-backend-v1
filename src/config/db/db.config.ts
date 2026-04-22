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

// In production (on Railway), use DATABASE_URL — the private internal network
// URL (postgres.railway.internal) which is fast and needs no SSL.
// Locally, use DATABASE_PUBLIC_URL — the public Railway proxy which needs SSL.
const isProduction = process.env.NODE_ENV === 'production';
const dbUrl = isProduction
  ? process.env.DATABASE_URL         // internal Railway network (fast, no SSL)
  : process.env.DATABASE_PUBLIC_URL; // public proxy for local dev (needs SSL)

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
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
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
