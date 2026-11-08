import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProcessingErrorToDatasets1794133223365 implements MigrationInterface {
    name = 'AddProcessingErrorToDatasets1794133223365'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "upload_sessions" RENAME COLUMN "toatlParts" TO "totalParts"`);
        await queryRunner.query(`ALTER TABLE "datasets" RENAME COLUMN "proccessingError" TO "processingError"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "datasets" RENAME COLUMN "processingError" TO "proccessingError"`);
        await queryRunner.query(`ALTER TABLE "upload_sessions" RENAME COLUMN "totalParts" TO "toatlParts"`);
    }

}
