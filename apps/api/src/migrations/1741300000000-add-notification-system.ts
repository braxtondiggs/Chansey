import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddNotificationSystem1741300000000 implements MigrationInterface {
  name = 'AddNotificationSystem1741300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add notification preferences to user table
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN "notificationPreferences" jsonb NOT NULL DEFAULT '${JSON.stringify({
        channels: { email: true, push: false, sms: false },
        events: {
          trade_executed: true,
          trade_error: true,
          risk_breach: true,
          drift_alert: true,
          trading_halted: true,
          daily_summary: true,
          strategy_deployed: true,
          strategy_demoted: true,
          daily_loss_limit: true
        },
        quietHours: { enabled: false, startHourUtc: 22, endHourUtc: 7 }
      })}'
    `);

    // 2. Create push subscription table
    await queryRunner.query(`
      CREATE TABLE "push_subscription" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "endpoint" text NOT NULL,
        "p256dh" text NOT NULL,
        "auth" text NOT NULL,
        "userAgent" varchar,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_subscription" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_push_subscription_endpoint" UNIQUE ("endpoint"),
        CONSTRAINT "FK_push_subscription_user" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_push_subscription_userId" ON "push_subscription" ("userId")
    `);

    // 3. Create in-app notification table
    await queryRunner.query(`
      CREATE TABLE "notification" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "eventType" varchar NOT NULL,
        "title" varchar NOT NULL,
        "body" text NOT NULL,
        "severity" varchar NOT NULL DEFAULT 'info',
        "read" boolean NOT NULL DEFAULT false,
        "metadata" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "readAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_notification" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notification_user" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notification_userId_read" ON "notification" ("userId", "read")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notification_userId_createdAt" ON "notification" ("userId", "createdAt" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notification_eventType" ON "notification" ("eventType")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_notification_eventType"`);
    await queryRunner.query(`DROP TABLE "notification"`);
    await queryRunner.query(`DROP TABLE "push_subscription"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "notificationPreferences"`);
  }
}
