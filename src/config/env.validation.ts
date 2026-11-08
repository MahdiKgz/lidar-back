import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),

  API_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().integer().min(1).max(65535).required(),
  REDIS_HOST: Joi.string().default('127.0.0.1'),
  REDIS_PORT: Joi.number().integer().min(1).max(65535).default(6379),
  REDIS_DB: Joi.number().integer().min(0).max(15).default(0),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  MINIO_CONFIGURE_BUCKET: Joi.boolean().default(false),
  PDAL_MODE: Joi.string().valid('docker', 'native').default('docker'),
  PDAL_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(86400000)
    .default(3600000),
  PROCESSING_WORKER_ENABLED: Joi.boolean().default(true),
  PROCESSING_CONCURRENCY: Joi.number().integer().min(1).max(32).default(1),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  MINIO_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),

  MINIO_PUBLIC_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),

  MINIO_ROOT_USER: Joi.string().required(),

  MINIO_ROOT_PASSWORD: Joi.string().min(8).required(),

  MINIO_REGION: Joi.string().default('us-east-1'),

  MINIO_BUCKET: Joi.string()
    .pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .required(),
});
