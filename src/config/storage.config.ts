import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.MINIO_ENDPOINT,
  publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT,

  accessKey: process.env.MINIO_ROOT_USER,
  secretKey: process.env.MINIO_ROOT_PASSWORD,

  region: process.env.MINIO_REGION,
  bucket: process.env.MINIO_BUCKET,
  configureBucket: process.env.MINIO_CONFIGURE_BUCKET === 'true',
}));
