import { registerAs } from '@nestjs/config';
import { type TypeOrmModuleOptions } from '@nestjs/typeorm';

import { join } from 'path';

export const databaseConfig = registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE,
    username: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    autoLoadEntities: true,
    entities: [join(__dirname, '**/*.entity{.ts,.js}')],
    migrations: [join(__dirname, '../migrations/*.{ts,js}')],
    migrationsTableName: 'migration',
    migrationsRun: process.env.NODE_ENV === 'production',
    // DEVELOPMENT ONLY - auto-sync schema changes (entities must use unique enumName per table)
    // For production: Use migrations: npx nx g @nx/nest:migration --project=api --name=<name>
    synchronize: process.env.NODE_ENV !== 'production',
    logging: process.env.NODE_ENV !== 'production',
    retryAttempts: 20,
    retryDelay: 90000,
    uuidExtension: 'pgcrypto',
    extra: {
      max: parseInt(process.env.PG_POOL_MAX || '20', 10),
      idleTimeoutMillis: parseInt(process.env.PG_POOL_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: 10000,
      statement_timeout: 60000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 30000,
      allowExitOnIdle: false
    }
  })
);
