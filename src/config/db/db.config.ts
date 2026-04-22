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

// Prefer DATABASE_PUBLIC_URL (Railway public proxy) when running locally,
// fall back to individual POSTGRES_* vars for Railway internal / other envs.
const dbUrl = process.env.DATABASE_PUBLIC_URL;

export const dataSourceOptions: DataSourceOptions = dbUrl
  ? {
      type: 'postgres',
      url: dbUrl,
      entities: entitiesPath,
      migrations: migrationsPath,
      synchronize: false,
      logging: false,
      ssl: { rejectUnauthorized: false },
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
      ssl: process.env.NODE_ENV !== 'local' ? { rejectUnauthorized: false } : false,
      // poolSize: Number(process.env.POSTGRES_POOL_SIZE),
    };

export const dataSource = new DataSource(
  dataSourceOptions as DataSourceOptions,
);
