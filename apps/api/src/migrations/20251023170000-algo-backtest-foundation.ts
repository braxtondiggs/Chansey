import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class AlgoBacktestFoundation20251023170000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'market_data_sets',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'label',
            type: 'varchar'
          },
          {
            name: 'source',
            type: 'enum',
            enum: ['EXCHANGE_STREAM', 'VENDOR_FEED', 'INTERNAL_CAPTURE']
          },
          {
            name: 'instrumentUniverse',
            type: 'text',
            isArray: true,
            default: 'ARRAY[]::text[]'
          },
          {
            name: 'timeframe',
            type: 'enum',
            enum: ['TICK', 'SECOND', 'MINUTE', 'HOUR', 'DAY']
          },
          {
            name: 'startAt',
            type: 'timestamptz'
          },
          {
            name: 'endAt',
            type: 'timestamptz'
          },
          {
            name: 'integrityScore',
            type: 'int'
          },
          {
            name: 'checksum',
            type: 'varchar'
          },
          {
            name: 'storageLocation',
            type: 'varchar'
          },
          {
            name: 'replayCapable',
            type: 'boolean',
            default: 'false'
          },
          {
            name: 'metadata',
            type: 'jsonb',
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

    await queryRunner.createIndex(
      'market_data_sets',
      new TableIndex({
        name: 'IDX_market_data_sets_source_timeframe',
        columnNames: ['source', 'timeframe']
      })
    );

    await queryRunner.createIndex(
      'market_data_sets',
      new TableIndex({
        name: 'IDX_market_data_sets_start_end',
        columnNames: ['startAt', 'endAt']
      })
    );

    await queryRunner.addColumns('backtests', [
      new TableColumn({
        name: 'configSnapshot',
        type: 'jsonb',
        isNullable: true
      }),
      new TableColumn({
        name: 'deterministicSeed',
        type: 'varchar',
        isNullable: true
      }),
      new TableColumn({
        name: 'warningFlags',
        type: 'text',
        isArray: true,
        default: 'ARRAY[]::text[]'
      }),
      new TableColumn({
        name: 'marketDataSetId',
        type: 'uuid',
        isNullable: true
      })
    ]);

    await queryRunner.createForeignKey(
      'backtests',
      new TableForeignKey({
        columnNames: ['marketDataSetId'],
        referencedTableName: 'market_data_sets',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      })
    );

    await queryRunner.createTable(
      new Table({
        name: 'backtest_signals',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'timestamp',
            type: 'timestamptz'
          },
          {
            name: 'signalType',
            type: 'enum',
            enum: ['ENTRY', 'EXIT', 'ADJUSTMENT', 'RISK_CONTROL']
          },
          {
            name: 'instrument',
            type: 'varchar'
          },
          {
            name: 'direction',
            type: 'enum',
            enum: ['LONG', 'SHORT', 'FLAT']
          },
          {
            name: 'quantity',
            type: 'decimal',
            precision: 18,
            scale: 8
          },
          {
            name: 'price',
            type: 'decimal',
            precision: 18,
            scale: 8,
            isNullable: true
          },
          {
            name: 'reason',
            type: 'text',
            isNullable: true
          },
          {
            name: 'confidence',
            type: 'decimal',
            precision: 5,
            scale: 4,
            isNullable: true
          },
          {
            name: 'payload',
            type: 'jsonb',
            isNullable: true
          },
          {
            name: 'backtestId',
            type: 'uuid'
          }
        ]
      })
    );

    await queryRunner.createIndex(
      'backtest_signals',
      new TableIndex({
        name: 'IDX_backtest_signals_backtest_timestamp',
        columnNames: ['backtestId', 'timestamp']
      })
    );

    await queryRunner.createForeignKey(
      'backtest_signals',
      new TableForeignKey({
        columnNames: ['backtestId'],
        referencedTableName: 'backtests',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    await queryRunner.createTable(
      new Table({
        name: 'simulated_order_fills',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'orderType',
            type: 'enum',
            enum: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['FILLED', 'PARTIAL', 'CANCELLED']
          },
          {
            name: 'filledQuantity',
            type: 'decimal',
            precision: 18,
            scale: 8
          },
          {
            name: 'averagePrice',
            type: 'decimal',
            precision: 18,
            scale: 8
          },
          {
            name: 'fees',
            type: 'decimal',
            precision: 18,
            scale: 8,
            default: '0'
          },
          {
            name: 'slippageBps',
            type: 'decimal',
            precision: 8,
            scale: 4,
            isNullable: true
          },
          {
            name: 'executionTimestamp',
            type: 'timestamptz'
          },
          {
            name: 'instrument',
            type: 'varchar',
            isNullable: true
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true
          },
          {
            name: 'backtestId',
            type: 'uuid'
          },
          {
            name: 'signalId',
            type: 'uuid',
            isNullable: true
          }
        ]
      })
    );

    await queryRunner.createIndex(
      'simulated_order_fills',
      new TableIndex({
        name: 'IDX_simulated_order_fills_backtest_execution',
        columnNames: ['backtestId', 'executionTimestamp']
      })
    );

    await queryRunner.createForeignKeys('simulated_order_fills', [
      new TableForeignKey({
        columnNames: ['backtestId'],
        referencedTableName: 'backtests',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      }),
      new TableForeignKey({
        columnNames: ['signalId'],
        referencedTableName: 'backtest_signals',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      })
    ]);

    await queryRunner.createTable(
      new Table({
        name: 'comparison_reports',
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
            type: 'varchar'
          },
          {
            name: 'filters',
            type: 'jsonb',
            isNullable: true
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()'
          },
          {
            name: 'createdByUserId',
            type: 'uuid',
            isNullable: true
          }
        ]
      })
    );

    await queryRunner.createForeignKey(
      'comparison_reports',
      new TableForeignKey({
        columnNames: ['createdByUserId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      })
    );

    await queryRunner.createTable(
      new Table({
        name: 'comparison_report_runs',
        columns: [
          {
            name: 'comparisonReportId',
            type: 'uuid',
            isPrimary: true
          },
          {
            name: 'backtestId',
            type: 'uuid',
            isPrimary: true
          }
        ]
      })
    );

    await queryRunner.createForeignKeys('comparison_report_runs', [
      new TableForeignKey({
        columnNames: ['comparisonReportId'],
        referencedTableName: 'comparison_reports',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      }),
      new TableForeignKey({
        columnNames: ['backtestId'],
        referencedTableName: 'backtests',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const comparisonReportRunsTable = await queryRunner.getTable('comparison_report_runs');
    if (comparisonReportRunsTable) {
      for (const foreignKey of comparisonReportRunsTable.foreignKeys) {
        await queryRunner.dropForeignKey('comparison_report_runs', foreignKey);
      }
    }
    await queryRunner.dropTable('comparison_report_runs', true);

    const comparisonReportsTable = await queryRunner.getTable('comparison_reports');
    if (comparisonReportsTable) {
      for (const foreignKey of comparisonReportsTable.foreignKeys) {
        await queryRunner.dropForeignKey('comparison_reports', foreignKey);
      }
    }
    await queryRunner.dropTable('comparison_reports', true);

    const simulatedOrderFillsTable = await queryRunner.getTable('simulated_order_fills');
    if (simulatedOrderFillsTable) {
      for (const foreignKey of simulatedOrderFillsTable.foreignKeys) {
        await queryRunner.dropForeignKey('simulated_order_fills', foreignKey);
      }
    }
    await queryRunner.dropIndex('simulated_order_fills', 'IDX_simulated_order_fills_backtest_execution');
    await queryRunner.dropTable('simulated_order_fills', true);

    const backtestSignalsTable = await queryRunner.getTable('backtest_signals');
    if (backtestSignalsTable) {
      for (const foreignKey of backtestSignalsTable.foreignKeys) {
        await queryRunner.dropForeignKey('backtest_signals', foreignKey);
      }
    }
    await queryRunner.dropIndex('backtest_signals', 'IDX_backtest_signals_backtest_timestamp');
    await queryRunner.dropTable('backtest_signals', true);

    const backtestsTable = await queryRunner.getTable('backtests');
    if (backtestsTable) {
      const marketDataSetFk = backtestsTable.foreignKeys.find((fk) => fk.columnNames.includes('marketDataSetId'));
      if (marketDataSetFk) {
        await queryRunner.dropForeignKey('backtests', marketDataSetFk);
      }
    }
    await queryRunner.dropColumn('backtests', 'marketDataSetId');
    await queryRunner.dropColumn('backtests', 'warningFlags');
    await queryRunner.dropColumn('backtests', 'deterministicSeed');
    await queryRunner.dropColumn('backtests', 'configSnapshot');

    await queryRunner.dropIndex('market_data_sets', 'IDX_market_data_sets_start_end');
    await queryRunner.dropIndex('market_data_sets', 'IDX_market_data_sets_source_timeframe');
    await queryRunner.dropTable('market_data_sets', true);

    await queryRunner.query('DROP TYPE IF EXISTS "market_data_sets_source_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "market_data_sets_timeframe_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "backtest_signals_signalType_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "backtest_signals_direction_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "simulated_order_fills_orderType_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "simulated_order_fills_status_enum"');
  }
}
