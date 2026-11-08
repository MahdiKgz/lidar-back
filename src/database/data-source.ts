import 'reflect-metadata';
import 'dotenv/config';

import { DataSource } from 'typeorm';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Dataset } from '../datasets/entities/dataset.entity.js';
import { UploadSession } from '../uploads/entities/upload-session.entity.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));

const requiredEnv = (key: string): string => {
  const value = process.env[key];

  if (!value) throw new Error(`Missing environment variable : ${key}`);
  return value;
};

const port = Number(process.env.DB_PORT ?? 5432);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Invalid db port');
}

export default new DataSource({
  type: 'postgres',

  host: requiredEnv('DB_HOST'),
  port,
  username: requiredEnv('DB_USERNAME'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),

  entities: [Dataset, UploadSession],

  migrations: [join(currentDirectory, 'migrations', '*{.ts,.js}')],

  synchronize: false,
  migrationsRun: false,
  migrationsTableName: 'typeorm_migrations',

  logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : false,
});
