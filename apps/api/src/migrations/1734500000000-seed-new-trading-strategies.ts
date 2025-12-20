import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedNewTradingStrategies1734500000000 implements MigrationInterface {
  name = 'SeedNewTradingStrategies1734500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // RSI Momentum Strategy
    await queryRunner.query(`
      INSERT INTO "algorithm" (
        "id", "name", "strategyId", "description", "category", "status",
        "evaluate", "cron", "version", "author", "weight", "config", "metrics", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'RSI Momentum',
        'rsi-momentum-001',
        'Generates buy signals when RSI indicates oversold conditions (RSI < 30) and sell signals when overbought (RSI > 70). Classic momentum-based strategy for identifying potential reversals.',
        'technical',
        'inactive',
        true,
        '0 */4 * * *',
        '1.0.0',
        'Chansey Team',
        3.0,
        '{"parameters": {"period": 14, "oversoldThreshold": 30, "overboughtThreshold": 70, "minConfidence": 0.6}, "settings": {"timeout": 30000, "retries": 3, "enableLogging": true}}'::jsonb,
        '{"totalExecutions": 0, "successfulExecutions": 0, "failedExecutions": 0, "successRate": 0, "averageExecutionTime": 0, "errorCount": 0}'::jsonb,
        NOW(),
        NOW()
      )
    `);

    // MACD Crossover Strategy
    await queryRunner.query(`
      INSERT INTO "algorithm" (
        "id", "name", "strategyId", "description", "category", "status",
        "evaluate", "cron", "version", "author", "weight", "config", "metrics", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'MACD Crossover',
        'macd-crossover-001',
        'Generates signals based on MACD line crossing the signal line. Bullish crossover triggers buy, bearish crossover triggers sell. Uses histogram for confirmation.',
        'technical',
        'inactive',
        true,
        '0 */4 * * *',
        '1.0.0',
        'Chansey Team',
        5.0,
        '{"parameters": {"fastPeriod": 12, "slowPeriod": 26, "signalPeriod": 9, "useHistogramConfirmation": true, "minConfidence": 0.6}, "settings": {"timeout": 30000, "retries": 3, "enableLogging": true}}'::jsonb,
        '{"totalExecutions": 0, "successfulExecutions": 0, "failedExecutions": 0, "successRate": 0, "averageExecutionTime": 0, "errorCount": 0}'::jsonb,
        NOW(),
        NOW()
      )
    `);

    // Bollinger Bands Breakout Strategy
    await queryRunner.query(`
      INSERT INTO "algorithm" (
        "id", "name", "strategyId", "description", "category", "status",
        "evaluate", "cron", "version", "author", "weight", "config", "metrics", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'Bollinger Bands Breakout',
        'bb-breakout-001',
        'Trades breakouts when price closes outside Bollinger Bands. Buy on upper band breakout for momentum continuation, sell on lower band breakout. Trades WITH the trend.',
        'technical',
        'inactive',
        true,
        '0 */4 * * *',
        '1.0.0',
        'Chansey Team',
        4.0,
        '{"parameters": {"period": 20, "stdDev": 2, "requireConfirmation": false, "minConfidence": 0.6}, "settings": {"timeout": 30000, "retries": 3, "enableLogging": true}}'::jsonb,
        '{"totalExecutions": 0, "successfulExecutions": 0, "failedExecutions": 0, "successRate": 0, "averageExecutionTime": 0, "errorCount": 0}'::jsonb,
        NOW(),
        NOW()
      )
    `);

    // RSI MACD Combo Strategy
    await queryRunner.query(`
      INSERT INTO "algorithm" (
        "id", "name", "strategyId", "description", "category", "status",
        "evaluate", "cron", "version", "author", "weight", "config", "metrics", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'RSI MACD Combo',
        'rsi-macd-combo-001',
        'Multi-indicator confirmation strategy requiring both RSI and MACD signals to align within a confirmation window. Higher confidence signals through dual confirmation.',
        'hybrid',
        'inactive',
        true,
        '0 */4 * * *',
        '1.0.0',
        'Chansey Team',
        9.0,
        '{"parameters": {"rsiPeriod": 14, "rsiOversold": 35, "rsiOverbought": 65, "macdFast": 12, "macdSlow": 26, "macdSignal": 9, "confirmationWindow": 3, "minConfidence": 0.7}, "settings": {"timeout": 30000, "retries": 3, "enableLogging": true}}'::jsonb,
        '{"totalExecutions": 0, "successfulExecutions": 0, "failedExecutions": 0, "successRate": 0, "averageExecutionTime": 0, "errorCount": 0}'::jsonb,
        NOW(),
        NOW()
      )
    `);

    // ATR Trailing Stop Strategy
    await queryRunner.query(`
      INSERT INTO "algorithm" (
        "id", "name", "strategyId", "description", "category", "status",
        "evaluate", "cron", "version", "author", "weight", "config", "metrics", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'ATR Trailing Stop',
        'atr-trailing-stop-001',
        'Dynamic stop-loss signals based on Average True Range. Adapts stop distance to market volatility. Generates STOP_LOSS signals when price breaches ATR-based trailing stop.',
        'technical',
        'inactive',
        true,
        '0 */4 * * *',
        '1.0.0',
        'Chansey Team',
        9.0,
        '{"parameters": {"atrPeriod": 14, "atrMultiplier": 2.5, "tradeDirection": "long", "useHighLow": true, "minConfidence": 0.6}, "settings": {"timeout": 30000, "retries": 3, "enableLogging": true}}'::jsonb,
        '{"totalExecutions": 0, "successfulExecutions": 0, "failedExecutions": 0, "successRate": 0, "averageExecutionTime": 0, "errorCount": 0}'::jsonb,
        NOW(),
        NOW()
      )
    `);

    // RSI Divergence Strategy
    await queryRunner.query(`
      INSERT INTO "algorithm" (
        "id", "name", "strategyId", "description", "category", "status",
        "evaluate", "cron", "version", "author", "weight", "config", "metrics", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'RSI Divergence',
        'rsi-divergence-001',
        'Detects divergence between price action and RSI indicator. Bullish divergence (price lower lows, RSI higher lows) signals potential reversal up. Strong reversal indicator.',
        'technical',
        'inactive',
        true,
        '0 */4 * * *',
        '1.0.0',
        'Chansey Team',
        7.0,
        '{"parameters": {"rsiPeriod": 14, "lookbackPeriod": 14, "pivotStrength": 2, "minDivergencePercent": 5, "minConfidence": 0.6}, "settings": {"timeout": 30000, "retries": 3, "enableLogging": true}}'::jsonb,
        '{"totalExecutions": 0, "successfulExecutions": 0, "failedExecutions": 0, "successRate": 0, "averageExecutionTime": 0, "errorCount": 0}'::jsonb,
        NOW(),
        NOW()
      )
    `);

    // Bollinger Band Squeeze Strategy
    await queryRunner.query(`
      INSERT INTO "algorithm" (
        "id", "name", "strategyId", "description", "category", "status",
        "evaluate", "cron", "version", "author", "weight", "config", "metrics", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'Bollinger Band Squeeze',
        'bb-squeeze-001',
        'Identifies low volatility squeeze conditions and trades the subsequent breakout. Low bandwidth signals impending volatility expansion. Direction determined by breakout direction.',
        'technical',
        'inactive',
        true,
        '0 */4 * * *',
        '1.0.0',
        'Chansey Team',
        6.5,
        '{"parameters": {"period": 20, "stdDev": 2, "squeezeThreshold": 0.04, "minSqueezeBars": 6, "breakoutConfirmation": true, "minConfidence": 0.6}, "settings": {"timeout": 30000, "retries": 3, "enableLogging": true}}'::jsonb,
        '{"totalExecutions": 0, "successfulExecutions": 0, "failedExecutions": 0, "successRate": 0, "averageExecutionTime": 0, "errorCount": 0}'::jsonb,
        NOW(),
        NOW()
      )
    `);

    // Triple EMA Strategy
    await queryRunner.query(`
      INSERT INTO "algorithm" (
        "id", "name", "strategyId", "description", "category", "status",
        "evaluate", "cron", "version", "author", "weight", "config", "metrics", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'Triple EMA',
        'triple-ema-001',
        'Uses three EMAs (fast, medium, slow) to identify strong trends. Signals when all three align in the same direction. Fast > Medium > Slow = bullish alignment.',
        'technical',
        'inactive',
        true,
        '0 */4 * * *',
        '1.0.0',
        'Chansey Team',
        7.5,
        '{"parameters": {"fastPeriod": 8, "mediumPeriod": 21, "slowPeriod": 55, "requireFullAlignment": true, "signalOnPartialCross": false, "minConfidence": 0.6}, "settings": {"timeout": 30000, "retries": 3, "enableLogging": true}}'::jsonb,
        '{"totalExecutions": 0, "successfulExecutions": 0, "failedExecutions": 0, "successRate": 0, "averageExecutionTime": 0, "errorCount": 0}'::jsonb,
        NOW(),
        NOW()
      )
    `);

    // EMA RSI Filter Strategy
    await queryRunner.query(`
      INSERT INTO "algorithm" (
        "id", "name", "strategyId", "description", "category", "status",
        "evaluate", "cron", "version", "author", "weight", "config", "metrics", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'EMA RSI Filter',
        'ema-rsi-filter-001',
        'EMA crossover strategy filtered by RSI to avoid entries at overbought/oversold extremes. Improves signal quality by not buying when overbought or selling when oversold.',
        'hybrid',
        'inactive',
        true,
        '0 */4 * * *',
        '1.0.0',
        'Chansey Team',
        8.0,
        '{"parameters": {"fastEmaPeriod": 12, "slowEmaPeriod": 26, "rsiPeriod": 14, "rsiMaxForBuy": 70, "rsiMinForSell": 30, "minConfidence": 0.6}, "settings": {"timeout": 30000, "retries": 3, "enableLogging": true}}'::jsonb,
        '{"totalExecutions": 0, "successfulExecutions": 0, "failedExecutions": 0, "successRate": 0, "averageExecutionTime": 0, "errorCount": 0}'::jsonb,
        NOW(),
        NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove all seeded strategies by their strategyId
    await queryRunner.query(`DELETE FROM "algorithm" WHERE "strategyId" = 'rsi-momentum-001'`);
    await queryRunner.query(`DELETE FROM "algorithm" WHERE "strategyId" = 'macd-crossover-001'`);
    await queryRunner.query(`DELETE FROM "algorithm" WHERE "strategyId" = 'bb-breakout-001'`);
    await queryRunner.query(`DELETE FROM "algorithm" WHERE "strategyId" = 'rsi-macd-combo-001'`);
    await queryRunner.query(`DELETE FROM "algorithm" WHERE "strategyId" = 'atr-trailing-stop-001'`);
    await queryRunner.query(`DELETE FROM "algorithm" WHERE "strategyId" = 'rsi-divergence-001'`);
    await queryRunner.query(`DELETE FROM "algorithm" WHERE "strategyId" = 'bb-squeeze-001'`);
    await queryRunner.query(`DELETE FROM "algorithm" WHERE "strategyId" = 'triple-ema-001'`);
    await queryRunner.query(`DELETE FROM "algorithm" WHERE "strategyId" = 'ema-rsi-filter-001'`);
  }
}
