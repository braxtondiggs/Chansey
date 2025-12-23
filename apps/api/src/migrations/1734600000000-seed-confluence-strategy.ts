import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedConfluenceStrategy1734600000000 implements MigrationInterface {
  name = 'SeedConfluenceStrategy1734600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Multi-Indicator Confluence Strategy
    await queryRunner.query(`
      INSERT INTO "algorithm" (
        "id", "name", "strategyId", "description", "category", "status",
        "evaluate", "cron", "version", "author", "weight", "config", "metrics", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'Multi-Indicator Confluence',
        'confluence-001',
        'Combines 5 indicator families (EMA, RSI, MACD, ATR, Bollinger Bands) and generates signals only when multiple indicators agree. Reduces false positives through multi-indicator confirmation. Configurable confluence threshold determines how many indicators must align.',
        'hybrid',
        'inactive',
        true,
        '0 */4 * * *',
        '1.0.0',
        'Chansey Team',
        10.0,
        '{"parameters": {"minConfluence": 3, "minConfidence": 0.65, "emaEnabled": true, "emaFastPeriod": 12, "emaSlowPeriod": 26, "rsiEnabled": true, "rsiPeriod": 14, "rsiBuyThreshold": 40, "rsiSellThreshold": 60, "macdEnabled": true, "macdFastPeriod": 12, "macdSlowPeriod": 26, "macdSignalPeriod": 9, "atrEnabled": true, "atrPeriod": 14, "atrVolatilityMultiplier": 1.5, "bbEnabled": true, "bbPeriod": 20, "bbStdDev": 2, "bbBuyThreshold": 0.2, "bbSellThreshold": 0.8}, "settings": {"timeout": 30000, "retries": 3, "enableLogging": true}}'::jsonb,
        '{"totalExecutions": 0, "successfulExecutions": 0, "failedExecutions": 0, "successRate": 0, "averageExecutionTime": 0, "errorCount": 0}'::jsonb,
        NOW(),
        NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "algorithm" WHERE "strategyId" = 'confluence-001'`);
  }
}
