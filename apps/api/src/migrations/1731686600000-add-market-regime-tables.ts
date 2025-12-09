import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddMarketRegimeTables1731686600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create market_regimes table
    await queryRunner.createTable(
      new Table({
        name: 'market_regimes',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'asset',
            type: 'varchar',
            length: '20',
            comment: 'Asset symbol (BTC, ETH, etc.)'
          },
          {
            name: 'regime',
            type: 'enum',
            enum: ['low_volatility', 'normal', 'high_volatility', 'extreme'],
            comment: 'Regime classification based on volatility percentiles'
          },
          {
            name: 'volatility',
            type: 'decimal',
            precision: 10,
            scale: 6,
            comment: 'Realized volatility value'
          },
          {
            name: 'percentile',
            type: 'decimal',
            precision: 5,
            scale: 2,
            comment: 'Volatility percentile (0-100)'
          },
          {
            name: 'detectedAt',
            type: 'timestamptz',
            default: 'now()'
          },
          {
            name: 'effectiveUntil',
            type: 'timestamptz',
            isNullable: true,
            comment: 'End of regime period (nullable for current regime)'
          },
          {
            name: 'previousRegimeId',
            type: 'uuid',
            isNullable: true,
            comment: 'Reference to previous regime (nullable for first regime)'
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
            comment: 'Additional regime detection metadata'
          }
        ]
      })
    );

    // Create indexes for market_regimes
    await queryRunner.createIndex(
      'market_regimes',
      new TableIndex({
        name: 'IDX_market_regimes_asset_detected',
        columnNames: ['asset', 'detectedAt']
      })
    );

    await queryRunner.createIndex(
      'market_regimes',
      new TableIndex({
        name: 'IDX_market_regimes_regime',
        columnNames: ['regime', 'detectedAt']
      })
    );

    await queryRunner.createIndex(
      'market_regimes',
      new TableIndex({
        name: 'IDX_market_regimes_current',
        columnNames: ['asset', 'effectiveUntil'],
        where: 'effectiveUntil IS NULL'
      })
    );

    // Create drift_alerts table
    await queryRunner.createTable(
      new Table({
        name: 'drift_alerts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'deploymentId',
            type: 'uuid'
          },
          {
            name: 'strategyId',
            type: 'uuid',
            comment: 'Foreign key to StrategyConfig'
          },
          {
            name: 'driftType',
            type: 'enum',
            enum: ['sharpe', 'return', 'drawdown', 'winrate', 'volatility'],
            comment: 'Type of drift detected'
          },
          {
            name: 'severity',
            type: 'enum',
            enum: ['warning', 'critical'],
            comment: 'Alert severity'
          },
          {
            name: 'expectedValue',
            type: 'decimal',
            precision: 15,
            scale: 6,
            comment: 'Expected metric value from backtest'
          },
          {
            name: 'observedValue',
            type: 'decimal',
            precision: 15,
            scale: 6,
            comment: 'Actual observed value'
          },
          {
            name: 'delta',
            type: 'decimal',
            precision: 10,
            scale: 4,
            comment: 'Percentage difference'
          },
          {
            name: 'recommendedAction',
            type: 'enum',
            enum: ['monitor', 'reduce_allocation', 'deactivate'],
            comment: 'System recommendation'
          },
          {
            name: 'detectedAt',
            type: 'timestamptz',
            default: 'now()'
          },
          {
            name: 'acknowledged',
            type: 'boolean',
            default: false
          },
          {
            name: 'acknowledgedBy',
            type: 'uuid',
            isNullable: true,
            comment: 'User who acknowledged (nullable)'
          },
          {
            name: 'acknowledgedAt',
            type: 'timestamptz',
            isNullable: true
          },
          {
            name: 'actionTaken',
            type: 'varchar',
            length: '50',
            isNullable: true,
            comment: 'Actual action taken (nullable)'
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true
          }
        ]
      })
    );

    // Create indexes for drift_alerts
    await queryRunner.createIndex(
      'drift_alerts',
      new TableIndex({
        name: 'IDX_drift_alerts_deployment_detected',
        columnNames: ['deploymentId', 'detectedAt']
      })
    );

    await queryRunner.createIndex(
      'drift_alerts',
      new TableIndex({
        name: 'IDX_drift_alerts_severity_acknowledged',
        columnNames: ['severity', 'acknowledged']
      })
    );

    await queryRunner.createIndex(
      'drift_alerts',
      new TableIndex({
        name: 'IDX_drift_alerts_strategy',
        columnNames: ['strategyId', 'detectedAt']
      })
    );

    // Create foreign keys for drift_alerts
    await queryRunner.query(`
      ALTER TABLE drift_alerts
      ADD CONSTRAINT FK_drift_alerts_deployment
      FOREIGN KEY ("deploymentId")
      REFERENCES deployments(id)
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE drift_alerts
      ADD CONSTRAINT FK_drift_alerts_strategy
      FOREIGN KEY ("strategyId")
      REFERENCES strategy_configs(id)
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE drift_alerts
      ADD CONSTRAINT FK_drift_alerts_acknowledged_by
      FOREIGN KEY ("acknowledgedBy")
      REFERENCES users(id)
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop drift_alerts table
    await queryRunner.query('ALTER TABLE drift_alerts DROP CONSTRAINT IF EXISTS FK_drift_alerts_acknowledged_by');
    await queryRunner.query('ALTER TABLE drift_alerts DROP CONSTRAINT IF EXISTS FK_drift_alerts_strategy');
    await queryRunner.query('ALTER TABLE drift_alerts DROP CONSTRAINT IF EXISTS FK_drift_alerts_deployment');

    await queryRunner.dropIndex('drift_alerts', 'IDX_drift_alerts_strategy');
    await queryRunner.dropIndex('drift_alerts', 'IDX_drift_alerts_severity_acknowledged');
    await queryRunner.dropIndex('drift_alerts', 'IDX_drift_alerts_deployment_detected');
    await queryRunner.dropTable('drift_alerts', true);

    // Drop market_regimes table
    await queryRunner.dropIndex('market_regimes', 'IDX_market_regimes_current');
    await queryRunner.dropIndex('market_regimes', 'IDX_market_regimes_regime');
    await queryRunner.dropIndex('market_regimes', 'IDX_market_regimes_asset_detected');
    await queryRunner.dropTable('market_regimes', true);

    // Drop enums
    await queryRunner.query('DROP TYPE IF EXISTS "market_regimes_regime_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "drift_alerts_driftType_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "drift_alerts_severity_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "drift_alerts_recommendedAction_enum"');
  }
}
