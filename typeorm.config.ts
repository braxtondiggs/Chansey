import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';

config();

// DataSource for CLI migrations - always uses compiled JS files (after build)
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432', 10),
  username: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  entities: ['dist/api/**/*.entity.js'],
  migrations: ['dist/api/migrations/*.js'],
  migrationsTableName: 'migration',
  synchronize: false, // CLI always uses migrations, never sync
  logging: true
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
