import { MigrationInterface, QueryRunner, TableColumn, Table, TableForeignKey, TableIndex } from 'typeorm';

export class AddAlgoTradingFields1731686700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add algo trading enrollment fields to users table
    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'algoTradingEnabled',
        type: 'boolean',
        default: false,
        comment: 'Whether user has opted into algorithmic trading'
      })
    );

    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'algoCapitalAllocation',
        type: 'decimal',
        precision: 12,
        scale: 2,
        isNullable: true,
        comment: 'Amount of capital allocated to algo trading'
      })
    );

    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'algoEnrolledAt',
        type: 'timestamptz',
        isNullable: true,
        comment: 'When user enrolled in algo trading'
      })
    );

    // 2. Add risk pool and shadow status fields to strategy_configs table
    await queryRunner.addColumn(
      'strategy_configs',
      new TableColumn({
        name: 'riskPoolId',
        type: 'uuid',
        isNullable: true,
        comment: 'Foreign key to risk table - which risk pool this strategy is assigned to'
      })
    );

    // Create shadow status enum
    await queryRunner.query(`
      CREATE TYPE "strategy_configs_shadowstatus_enum" AS ENUM ('testing', 'shadow', 'live', 'retired')
    `);

    await queryRunner.addColumn(
      'strategy_configs',
      new TableColumn({
        name: 'shadowStatus',
        type: 'enum',
        enum: ['testing', 'shadow', 'live', 'retired'],
        default: "'testing'",
        comment:
          'Lifecycle status: testing (backtest only), shadow (paper trading), live (real money), retired (removed from pools)'
      })
    );

    // Create foreign key from strategy_configs to risk
    await queryRunner.createForeignKey(
      'strategy_configs',
      new TableForeignKey({
        columnNames: ['riskPoolId'],
        referencedTableName: 'risk',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      })
    );

    // 3. Create user_strategy_positions table
    await queryRunner.createTable(
      new Table({
        name: 'user_strategy_positions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'userId',
            type: 'uuid',
            comment: 'User who owns this position'
          },
          {
            name: 'strategyConfigId',
            type: 'uuid',
            comment: 'Strategy that created and manages this position'
          },
          {
            name: 'symbol',
            type: 'varchar',
            length: '20',
            comment: 'Trading pair (e.g., BTCUSDT, ETHUSDT)'
          },
          {
            name: 'quantity',
            type: 'decimal',
            precision: 20,
            scale: 8,
            comment: 'Current quantity held'
          },
          {
            name: 'avgEntryPrice',
            type: 'decimal',
            precision: 12,
            scale: 2,
            comment: 'Average entry price (cost basis)'
          },
          {
            name: 'unrealizedPnL',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
            comment: 'Unrealized profit/loss (current position)'
          },
          {
            name: 'realizedPnL',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
            comment: 'Realized profit/loss (closed trades)'
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()',
            comment: 'When this position was first opened'
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()',
            comment: 'Last time this position was updated'
          }
        ]
      })
    );

    // Create unique index on userId + strategyConfigId + symbol
    await queryRunner.createIndex(
      'user_strategy_positions',
      new TableIndex({
        name: 'IDX_user_strategy_positions_unique',
        columnNames: ['userId', 'strategyConfigId', 'symbol'],
        isUnique: true
      })
    );

    // Create indexes for lookups
    await queryRunner.createIndex(
      'user_strategy_positions',
      new TableIndex({
        name: 'IDX_user_strategy_positions_userId',
        columnNames: ['userId']
      })
    );

    await queryRunner.createIndex(
      'user_strategy_positions',
      new TableIndex({
        name: 'IDX_user_strategy_positions_strategyConfigId',
        columnNames: ['strategyConfigId']
      })
    );

    // Create foreign keys
    await queryRunner.createForeignKey(
      'user_strategy_positions',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    await queryRunner.createForeignKey(
      'user_strategy_positions',
      new TableForeignKey({
        columnNames: ['strategyConfigId'],
        referencedTableName: 'strategy_configs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    // 4. Add strategy tracking fields to order table
    await queryRunner.addColumn(
      'order',
      new TableColumn({
        name: 'strategyConfigId',
        type: 'uuid',
        isNullable: true,
        comment: 'Strategy configuration that generated this algorithmic order (for robo-advisor)'
      })
    );

    await queryRunner.addColumn(
      'order',
      new TableColumn({
        name: 'is_algorithmic_trade',
        type: 'boolean',
        default: false,
        comment: 'Whether this order was placed by the automated algo trading system'
      })
    );

    // Create index for strategy order lookups
    await queryRunner.createIndex(
      'order',
      new TableIndex({
        name: 'IDX_order_strategyConfigId',
        columnNames: ['strategyConfigId']
      })
    );

    // Create foreign key from order to strategy_configs
    await queryRunner.createForeignKey(
      'order',
      new TableForeignKey({
        columnNames: ['strategyConfigId'],
        referencedTableName: 'strategy_configs',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 4. Drop order table columns
    const orderTable = await queryRunner.getTable('order');
    if (orderTable) {
      const strategyConfigFk = orderTable.foreignKeys.find((fk) => fk.columnNames.indexOf('strategyConfigId') !== -1);
      if (strategyConfigFk) {
        await queryRunner.dropForeignKey('order', strategyConfigFk);
      }
    }
    await queryRunner.dropIndex('order', 'IDX_order_strategyConfigId');
    await queryRunner.dropColumn('order', 'is_algorithmic_trade');
    await queryRunner.dropColumn('order', 'strategyConfigId');

    // 3. Drop user_strategy_positions table
    const userStrategyPositionsTable = await queryRunner.getTable('user_strategy_positions');
    if (userStrategyPositionsTable) {
      for (const foreignKey of userStrategyPositionsTable.foreignKeys) {
        await queryRunner.dropForeignKey('user_strategy_positions', foreignKey);
      }
    }
    await queryRunner.dropIndex('user_strategy_positions', 'IDX_user_strategy_positions_strategyConfigId');
    await queryRunner.dropIndex('user_strategy_positions', 'IDX_user_strategy_positions_userId');
    await queryRunner.dropIndex('user_strategy_positions', 'IDX_user_strategy_positions_unique');
    await queryRunner.dropTable('user_strategy_positions', true);

    // 2. Drop strategy_configs columns
    const strategyConfigsTable = await queryRunner.getTable('strategy_configs');
    if (strategyConfigsTable) {
      const riskPoolFk = strategyConfigsTable.foreignKeys.find((fk) => fk.columnNames.indexOf('riskPoolId') !== -1);
      if (riskPoolFk) {
        await queryRunner.dropForeignKey('strategy_configs', riskPoolFk);
      }
    }
    await queryRunner.dropColumn('strategy_configs', 'shadowStatus');
    await queryRunner.dropColumn('strategy_configs', 'riskPoolId');
    await queryRunner.query('DROP TYPE IF EXISTS "strategy_configs_shadowstatus_enum"');

    // 1. Drop user table columns
    await queryRunner.dropColumn('user', 'algoEnrolledAt');
    await queryRunner.dropColumn('user', 'algoCapitalAllocation');
    await queryRunner.dropColumn('user', 'algoTradingEnabled');
  }
}
