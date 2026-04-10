import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateFailedJobLogs1748500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "failed_job_status_enum" AS ENUM ('pending', 'reviewed', 'retried', 'dismissed')
    `);

    await queryRunner.query(`
      CREATE TYPE "failed_job_severity_enum" AS ENUM ('critical', 'high', 'medium', 'low')
    `);

    await queryRunner.query(`
      CREATE TABLE "failed_job_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "queueName" varchar(100) NOT NULL,
        "jobId" varchar(255) NOT NULL,
        "jobName" varchar(255) NOT NULL,
        "jobData" jsonb,
        "errorMessage" text NOT NULL,
        "stackTrace" text,
        "attemptsMade" int NOT NULL DEFAULT 0,
        "maxAttempts" int NOT NULL DEFAULT 0,
        "userId" uuid,
        "status" "failed_job_status_enum" NOT NULL DEFAULT 'pending',
        "severity" "failed_job_severity_enum" NOT NULL DEFAULT 'low',
        "adminNotes" text,
        "reviewedBy" uuid,
        "reviewedAt" timestamptz,
        "context" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_failed_job_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_failed_job_logs_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_failed_job_logs_reviewedBy" FOREIGN KEY ("reviewedBy") REFERENCES "user"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_failed_job_logs_queue_created" ON "failed_job_logs" ("queueName", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_failed_job_logs_status_created" ON "failed_job_logs" ("status", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_failed_job_logs_severity_created" ON "failed_job_logs" ("severity", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_failed_job_logs_userId_created" ON "failed_job_logs" ("userId", "createdAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "failed_job_logs"`);
    await queryRunner.query(`DROP TYPE "failed_job_severity_enum"`);
    await queryRunner.query(`DROP TYPE "failed_job_status_enum"`);
  }
}
