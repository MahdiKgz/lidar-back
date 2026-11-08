import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDatasets1794117740482 implements MigrationInterface {
    name = 'CreateDatasets1794117740482'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "datasets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "originalFilename" character varying(255) NOT NULL, "fileFormat" character varying(10) NOT NULL, "fileSize" bigint NOT NULL, "originalObjectKey" character varying(512), "status" character varying(20) NOT NULL DEFAULT 'UPLOADING', "metadata" jsonb, "proccessingError" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "UQ_59c6ff55725a565175f1520b211" UNIQUE ("originalObjectKey"), CONSTRAINT "PK_1bf831e43c559a240303e23d038" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_datasets_status_created_at" ON "datasets"  ("status", "createdAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_datasets_status_created_at"`);
        await queryRunner.query(`DROP TABLE "datasets"`);
    }

}
