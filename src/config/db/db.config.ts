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

export const dataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  entities: entitiesPath,
  migrations: migrationsPath,
  autoLoadEntities: true,
  synchronize: false,
  logging: false,
  // poolSize: Number(process.env.POSTGRES_POOL_SIZE),
};

export const dataSource = new DataSource(
  dataSourceOptions as DataSourceOptions,
);
