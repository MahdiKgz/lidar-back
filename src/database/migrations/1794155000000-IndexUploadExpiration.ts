import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexUploadExpiration1794155000000 implements MigrationInterface {
  name = 'IndexUploadExpiration1794155000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_upload_sessions_active_expiry" ON "upload_sessions" ("expiresAt") WHERE "status" IN ('INITIATED', 'UPLOADING')`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_upload_sessions_active_expiry"');
  }
}
