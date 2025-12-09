import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateStrategyTables1731686400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create strategy_configs table
    await queryRunner.createTable(
      new Table({
        name: 'strategy_configs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255'
          },
          {
            name: 'algorithmId',
            type: 'uuid',
            comment: 'Foreign key to algorithms table - references existing algorithm implementation'
          },
          {
            name: 'parameters',
            type: 'jsonb',
            comment: 'Strategy-specific parameters that override algorithm defaults'
          },
          {
            name: 'version',
            type: 'varchar',
            length: '50'
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['draft', 'testing', 'validated', 'live', 'deprecated', 'failed', 'rejected', 'deactivated'],
            default: "'draft'"
          },
          {
            name: 'parentId',
            type: 'uuid',
            isNullable: true,
            comment: 'Reference to parent strategy for version tracking'
          },
          {
            name: 'createdBy',
            type: 'uuid',
            isNullable: true
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()'
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()'
          }
        ]
      })
    );

    // Create indexes for strategy_configs
    await queryRunner.createIndex(
      'strategy_configs',
      new TableIndex({
        name: 'IDX_strategy_configs_status',
        columnNames: ['status']
      })
    );

    await queryRunner.createIndex(
      'strategy_configs',
      new TableIndex({
        name: 'IDX_strategy_configs_algorithm',
        columnNames: ['algorithmId']
      })
    );

    // Create foreign keys for strategy_configs
    await queryRunner.createForeignKey(
      'strategy_configs',
      new TableForeignKey({
        columnNames: ['algorithmId'],
        referencedTableName: 'algorithms',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT'
      })
    );

    await queryRunner.createForeignKey(
      'strategy_configs',
      new TableForeignKey({
        columnNames: ['parentId'],
        referencedTableName: 'strategy_configs',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      })
    );

    await queryRunner.createForeignKey(
      'strategy_configs',
      new TableForeignKey({
        columnNames: ['createdBy'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      })
    );

    // Create backtest_runs table
    await queryRunner.createTable(
      new Table({
        name: 'backtest_runs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'strategyConfigId',
            type: 'uuid'
          },
          {
            name: 'startedAt',
            type: 'timestamptz'
          },
          {
            name: 'completedAt',
            type: 'timestamptz',
            isNullable: true
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['pending', 'running', 'completed', 'failed'],
            default: "'pending'"
          },
          {
            name: 'config',
            type: 'jsonb',
            comment: 'Complete configuration used for the run'
          },
          {
            name: 'datasetChecksum',
            type: 'varchar',
            length: '64',
            comment: 'SHA-256 hash of dataset for reproducibility'
          },
          {
            name: 'windowCount',
            type: 'int',
            default: 0
          },
          {
            name: 'results',
            type: 'jsonb',
            isNullable: true,
            comment: 'Aggregated results JSON'
          },
          {
            name: 'errorMessage',
            type: 'text',
            isNullable: true
          },
          {
            name: 'executionTimeMs',
            type: 'int',
            isNullable: true,
            comment: 'Total execution time in milliseconds'
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()'
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()'
          }
        ]
      })
    );

    // Create indexes for backtest_runs
    await queryRunner.createIndex(
      'backtest_runs',
      new TableIndex({
        name: 'IDX_backtest_runs_strategy_created',
        columnNames: ['strategyConfigId', 'createdAt']
      })
    );

    await queryRunner.createIndex(
      'backtest_runs',
      new TableIndex({
        name: 'IDX_backtest_runs_status',
        columnNames: ['status']
      })
    );

    // Create foreign key for backtest_runs
    await queryRunner.createForeignKey(
      'backtest_runs',
      new TableForeignKey({
        columnNames: ['strategyConfigId'],
        referencedTableName: 'strategy_configs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    // Create walk_forward_windows table
    await queryRunner.createTable(
      new Table({
        name: 'walk_forward_windows',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'backtestRunId',
            type: 'uuid'
          },
          {
            name: 'windowIndex',
            type: 'int'
          },
          {
            name: 'trainStartDate',
            type: 'date'
          },
          {
            name: 'trainEndDate',
            type: 'date'
          },
          {
            name: 'testStartDate',
            type: 'date'
          },
          {
            name: 'testEndDate',
            type: 'date'
          },
          {
            name: 'trainMetrics',
            type: 'jsonb',
            comment: 'Training period performance metrics'
          },
          {
            name: 'testMetrics',
            type: 'jsonb',
            comment: 'Test period performance metrics'
          },
          {
            name: 'degradation',
            type: 'decimal',
            precision: 10,
            scale: 4,
            comment: 'Percentage performance degradation from train to test'
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()'
          }
        ]
      })
    );

    // Create index for walk_forward_windows
    await queryRunner.createIndex(
      'walk_forward_windows',
      new TableIndex({
        name: 'IDX_walk_forward_windows_backtest_window',
        columnNames: ['backtestRunId', 'windowIndex']
      })
    );

    // Create foreign key for walk_forward_windows
    await queryRunner.createForeignKey(
      'walk_forward_windows',
      new TableForeignKey({
        columnNames: ['backtestRunId'],
        referencedTableName: 'backtest_runs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    // Create strategy_scores table
    await queryRunner.createTable(
      new Table({
        name: 'strategy_scores',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'strategyConfigId',
            type: 'uuid'
          },
          {
            name: 'overallScore',
            type: 'decimal',
            precision: 5,
            scale: 2,
            comment: 'Weighted composite score (0-100)'
          },
          {
            name: 'componentScores',
            type: 'jsonb',
            comment: 'Individual metric scores JSON'
          },
          {
            name: 'percentile',
            type: 'decimal',
            precision: 5,
            scale: 2,
            comment: 'Rank percentile among all strategies'
          },
          {
            name: 'grade',
            type: 'varchar',
            length: '2',
            comment: 'Letter grade (A-F)'
          },
          {
            name: 'promotionEligible',
            type: 'boolean',
            default: false
          },
          {
            name: 'warnings',
            type: 'text',
            isArray: true,
            default: 'ARRAY[]::text[]'
          },
          {
            name: 'calculatedAt',
            type: 'timestamptz',
            default: 'now()'
          },
          {
            name: 'effectiveDate',
            type: 'date'
          },
          {
            name: 'backtestRunIds',
            type: 'uuid',
            isArray: true,
            default: 'ARRAY[]::uuid[]',
            comment: 'Array of BacktestRun IDs used'
          }
        ]
      })
    );

    // Create indexes for strategy_scores
    await queryRunner.createIndex(
      'strategy_scores',
      new TableIndex({
        name: 'IDX_strategy_scores_strategy_effective',
        columnNames: ['strategyConfigId', 'effectiveDate']
      })
    );

    await queryRunner.createIndex(
      'strategy_scores',
      new TableIndex({
        name: 'IDX_strategy_scores_percentile',
        columnNames: ['percentile']
      })
    );

    // Create foreign key for strategy_scores
    await queryRunner.createForeignKey(
      'strategy_scores',
      new TableForeignKey({
        columnNames: ['strategyConfigId'],
        referencedTableName: 'strategy_configs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    // Create deployments table
    await queryRunner.createTable(
      new Table({
        name: 'deployments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'strategyConfigId',
            type: 'uuid'
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['active', 'paused', 'deactivated'],
            default: "'active'"
          },
          {
            name: 'allocationPercentage',
            type: 'decimal',
            precision: 5,
            scale: 2,
            comment: 'Percentage of capital allocated'
          },
          {
            name: 'phase',
            type: 'enum',
            enum: ['initial', 'growth', 'full'],
            default: "'initial'",
            comment: 'Deployment phase (initial: 1-2%, growth: 3-5%, full: 5-10%)'
          },
          {
            name: 'riskLimits',
            type: 'jsonb',
            comment: 'JSON object with risk parameters'
          },
          {
            name: 'promotionScore',
            type: 'decimal',
            precision: 5,
            scale: 2,
            comment: 'Score at time of promotion'
          },
          {
            name: 'promotionUserId',
            type: 'uuid',
            isNullable: true,
            comment: 'User who approved promotion'
          },
          {
            name: 'startedAt',
            type: 'timestamptz',
            default: 'now()'
          },
          {
            name: 'endedAt',
            type: 'timestamptz',
            isNullable: true
          },
          {
            name: 'pausedUntil',
            type: 'timestamptz',
            isNullable: true,
            comment: 'Temporary pause expiry'
          },
          {
            name: 'deactivationReason',
            type: 'text',
            isNullable: true
          },
          {
            name: 'totalCapital',
            type: 'decimal',
            precision: 20,
            scale: 8,
            isNullable: true,
            comment: 'Total capital at deployment'
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()'
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()'
          }
        ]
      })
    );

    // Create indexes for deployments
    await queryRunner.createIndex(
      'deployments',
      new TableIndex({
        name: 'IDX_deployments_status',
        columnNames: ['status']
      })
    );

    await queryRunner.createIndex(
      'deployments',
      new TableIndex({
        name: 'IDX_deployments_strategy',
        columnNames: ['strategyConfigId']
      })
    );

    // Create foreign keys for deployments
    await queryRunner.createForeignKey(
      'deployments',
      new TableForeignKey({
        columnNames: ['strategyConfigId'],
        referencedTableName: 'strategy_configs',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT'
      })
    );

    await queryRunner.createForeignKey(
      'deployments',
      new TableForeignKey({
        columnNames: ['promotionUserId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      })
    );

    // Create performance_metrics table
    await queryRunner.createTable(
      new Table({
        name: 'performance_metrics',
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
            name: 'metricDate',
            type: 'date'
          },
          {
            name: 'dailyReturn',
            type: 'decimal',
            precision: 10,
            scale: 6,
            comment: 'Daily return percentage'
          },
          {
            name: 'cumulativeReturn',
            type: 'decimal',
            precision: 10,
            scale: 6,
            comment: 'Cumulative return since deployment'
          },
          {
            name: 'sharpeRatio',
            type: 'decimal',
            precision: 10,
            scale: 4,
            comment: 'Rolling 30-day Sharpe ratio'
          },
          {
            name: 'maxDrawdown',
            type: 'decimal',
            precision: 10,
            scale: 6,
            comment: 'Maximum drawdown to date'
          },
          {
            name: 'winRate',
            type: 'decimal',
            precision: 5,
            scale: 2,
            comment: 'Win rate percentage'
          },
          {
            name: 'tradeCount',
            type: 'int',
            comment: 'Number of trades executed'
          },
          {
            name: 'volatility',
            type: 'decimal',
            precision: 10,
            scale: 6,
            comment: 'Annualized volatility'
          },
          {
            name: 'benchmarkReturn',
            type: 'decimal',
            precision: 10,
            scale: 6,
            isNullable: true,
            comment: 'Benchmark return for comparison'
          },
          {
            name: 'calculatedAt',
            type: 'timestamptz',
            default: 'now()'
          }
        ]
      })
    );

    // Create unique constraint and index for performance_metrics
    await queryRunner.createIndex(
      'performance_metrics',
      new TableIndex({
        name: 'IDX_performance_metrics_deployment_date',
        columnNames: ['deploymentId', 'metricDate'],
        isUnique: true
      })
    );

    // Create foreign key for performance_metrics
    await queryRunner.createForeignKey(
      'performance_metrics',
      new TableForeignKey({
        columnNames: ['deploymentId'],
        referencedTableName: 'deployments',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop performance_metrics table
    const performanceMetricsTable = await queryRunner.getTable('performance_metrics');
    if (performanceMetricsTable) {
      for (const foreignKey of performanceMetricsTable.foreignKeys) {
        await queryRunner.dropForeignKey('performance_metrics', foreignKey);
      }
    }
    await queryRunner.dropIndex('performance_metrics', 'IDX_performance_metrics_deployment_date');
    await queryRunner.dropTable('performance_metrics', true);

    // Drop deployments table
    const deploymentsTable = await queryRunner.getTable('deployments');
    if (deploymentsTable) {
      for (const foreignKey of deploymentsTable.foreignKeys) {
        await queryRunner.dropForeignKey('deployments', foreignKey);
      }
    }
    await queryRunner.dropIndex('deployments', 'IDX_deployments_strategy');
    await queryRunner.dropIndex('deployments', 'IDX_deployments_status');
    await queryRunner.dropTable('deployments', true);

    // Drop strategy_scores table
    const strategyScoresTable = await queryRunner.getTable('strategy_scores');
    if (strategyScoresTable) {
      for (const foreignKey of strategyScoresTable.foreignKeys) {
        await queryRunner.dropForeignKey('strategy_scores', foreignKey);
      }
    }
    await queryRunner.dropIndex('strategy_scores', 'IDX_strategy_scores_percentile');
    await queryRunner.dropIndex('strategy_scores', 'IDX_strategy_scores_strategy_effective');
    await queryRunner.dropTable('strategy_scores', true);

    // Drop walk_forward_windows table
    const walkForwardWindowsTable = await queryRunner.getTable('walk_forward_windows');
    if (walkForwardWindowsTable) {
      for (const foreignKey of walkForwardWindowsTable.foreignKeys) {
        await queryRunner.dropForeignKey('walk_forward_windows', foreignKey);
      }
    }
    await queryRunner.dropIndex('walk_forward_windows', 'IDX_walk_forward_windows_backtest_window');
    await queryRunner.dropTable('walk_forward_windows', true);

    // Drop backtest_runs table
    const backtestRunsTable = await queryRunner.getTable('backtest_runs');
    if (backtestRunsTable) {
      for (const foreignKey of backtestRunsTable.foreignKeys) {
        await queryRunner.dropForeignKey('backtest_runs', foreignKey);
      }
    }
    await queryRunner.dropIndex('backtest_runs', 'IDX_backtest_runs_status');
    await queryRunner.dropIndex('backtest_runs', 'IDX_backtest_runs_strategy_created');
    await queryRunner.dropTable('backtest_runs', true);

    // Drop strategy_configs table
    const strategyConfigsTable = await queryRunner.getTable('strategy_configs');
    if (strategyConfigsTable) {
      for (const foreignKey of strategyConfigsTable.foreignKeys) {
        await queryRunner.dropForeignKey('strategy_configs', foreignKey);
      }
    }
    await queryRunner.dropIndex('strategy_configs', 'IDX_strategy_configs_algorithm');
    await queryRunner.dropIndex('strategy_configs', 'IDX_strategy_configs_status');
    await queryRunner.dropTable('strategy_configs', true);

    // Drop enums
    await queryRunner.query('DROP TYPE IF EXISTS "strategy_configs_status_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "backtest_runs_status_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "deployments_status_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "deployments_phase_enum"');
  }
}
