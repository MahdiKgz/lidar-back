import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUploadSessions1794119385171 implements MigrationInterface {
    name = 'CreateUploadSessions1794119385171'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "upload_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "objectKey" character varying(512) NOT NULL, "storageUploadId" character varying(255) NOT NULL, "partSize" integer NOT NULL, "toatlParts" integer NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'INITIATED', "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "completedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "dataset_id" uuid NOT NULL, CONSTRAINT "PK_4b6ca30b8bb2baa0de9c6bf8fea" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_upload_sessions_dataset_id" ON "upload_sessions"  ("dataset_id") `);
        await queryRunner.query(`DROP INDEX "public"."IDX_datasets_status_created_at"`);
        await queryRunner.query(`ALTER TABLE "datasets" ALTER COLUMN "createdAt" SET DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "datasets" ALTER COLUMN "updatedAt" SET DEFAULT now()`);
        await queryRunner.query(`CREATE INDEX "IDX_datasets_status_created_at" ON "datasets"  ("status", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "upload_sessions" ADD CONSTRAINT "FK_9505f58e6c0e2154ff162aca4df" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "upload_sessions" DROP CONSTRAINT "FK_9505f58e6c0e2154ff162aca4df"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_datasets_status_created_at"`);
        await queryRunner.query(`ALTER TABLE "datasets" ALTER COLUMN "updatedAt" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "datasets" ALTER COLUMN "createdAt" DROP DEFAULT`);
        await queryRunner.query(`CREATE INDEX "IDX_datasets_status_created_at" ON "datasets" USING btree ("status", "createdAt") `);
        await queryRunner.query(`DROP INDEX "public"."IDX_upload_sessions_dataset_id"`);
        await queryRunner.query(`DROP TABLE "upload_sessions"`);
    }

}
