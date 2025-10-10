import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class AddAlgorithmAutomation1728494000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create algorithm_activations table
    await queryRunner.createTable(
      new Table({
        name: 'algorithm_activations',
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
            isNullable: false
          },
          {
            name: 'algorithmId',
            type: 'uuid',
            isNullable: false
          },
          {
            name: 'exchangeKeyId',
            type: 'uuid',
            isNullable: false
          },
          {
            name: 'isActive',
            type: 'boolean',
            default: false
          },
          {
            name: 'allocationPercentage',
            type: 'decimal',
            precision: 5,
            scale: 2,
            default: 1.0
          },
          {
            name: 'config',
            type: 'jsonb',
            isNullable: true
          },
          {
            name: 'activatedAt',
            type: 'timestamptz',
            isNullable: true
          },
          {
            name: 'deactivatedAt',
            type: 'timestamptz',
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
      }),
      true
    );

    // Create algorithm_performances table
    await queryRunner.createTable(
      new Table({
        name: 'algorithm_performances',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'algorithmActivationId',
            type: 'uuid',
            isNullable: false
          },
          {
            name: 'userId',
            type: 'uuid',
            isNullable: false
          },
          {
            name: 'roi',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true
          },
          {
            name: 'winRate',
            type: 'decimal',
            precision: 5,
            scale: 2,
            isNullable: true
          },
          {
            name: 'sharpeRatio',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true
          },
          {
            name: 'maxDrawdown',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true
          },
          {
            name: 'totalTrades',
            type: 'integer',
            default: 0
          },
          {
            name: 'riskAdjustedReturn',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true
          },
          {
            name: 'volatility',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true
          },
          {
            name: 'alpha',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true
          },
          {
            name: 'beta',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true
          },
          {
            name: 'rank',
            type: 'integer',
            isNullable: true
          },
          {
            name: 'calculatedAt',
            type: 'timestamptz',
            isNullable: false
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()'
          }
        ]
      }),
      true
    );

    // Add algorithmActivationId column to orders table
    await queryRunner.addColumn(
      'order',
      new TableColumn({
        name: 'algorithmActivationId',
        type: 'uuid',
        isNullable: true
      })
    );

    // Add foreign keys
    await queryRunner.createForeignKey(
      'algorithm_activations',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    await queryRunner.createForeignKey(
      'algorithm_activations',
      new TableForeignKey({
        columnNames: ['algorithmId'],
        referencedTableName: 'algorithm',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    await queryRunner.createForeignKey(
      'algorithm_activations',
      new TableForeignKey({
        columnNames: ['exchangeKeyId'],
        referencedTableName: 'exchange_key',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    await queryRunner.createForeignKey(
      'algorithm_performances',
      new TableForeignKey({
        columnNames: ['algorithmActivationId'],
        referencedTableName: 'algorithm_activations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    await queryRunner.createForeignKey(
      'algorithm_performances',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    await queryRunner.createForeignKey(
      'order',
      new TableForeignKey({
        columnNames: ['algorithmActivationId'],
        referencedTableName: 'algorithm_activations',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      })
    );

    // Create indexes
    await queryRunner.createIndex(
      'order',
      new TableIndex({
        name: 'IDX_order_algorithmActivationId',
        columnNames: ['algorithmActivationId']
      })
    );

    await queryRunner.createIndex(
      'algorithm_activations',
      new TableIndex({
        name: 'IDX_algorithm_activation_user_algorithm',
        columnNames: ['userId', 'algorithmId'],
        isUnique: true
      })
    );

    await queryRunner.createIndex(
      'algorithm_activations',
      new TableIndex({
        name: 'IDX_algorithm_activation_user_active',
        columnNames: ['userId', 'isActive']
      })
    );

    await queryRunner.createIndex(
      'algorithm_activations',
      new TableIndex({
        name: 'IDX_algorithm_activation_exchangeKey',
        columnNames: ['exchangeKeyId']
      })
    );

    await queryRunner.createIndex(
      'algorithm_performances',
      new TableIndex({
        name: 'IDX_algorithm_performance_activation_calculated',
        columnNames: ['algorithmActivationId', 'calculatedAt']
      })
    );

    await queryRunner.createIndex(
      'algorithm_performances',
      new TableIndex({
        name: 'IDX_algorithm_performance_user_rank',
        columnNames: ['userId', 'rank']
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex('algorithm_performances', 'IDX_algorithm_performance_user_rank');
    await queryRunner.dropIndex('algorithm_performances', 'IDX_algorithm_performance_activation_calculated');
    await queryRunner.dropIndex('algorithm_activations', 'IDX_algorithm_activation_exchangeKey');
    await queryRunner.dropIndex('algorithm_activations', 'IDX_algorithm_activation_user_active');
    await queryRunner.dropIndex('algorithm_activations', 'IDX_algorithm_activation_user_algorithm');
    await queryRunner.dropIndex('order', 'IDX_order_algorithmActivationId');

    // Drop foreign keys
    const orderTable = await queryRunner.getTable('order');
    const orderForeignKey = orderTable.foreignKeys.find((fk) => fk.columnNames.indexOf('algorithmActivationId') !== -1);
    if (orderForeignKey) {
      await queryRunner.dropForeignKey('order', orderForeignKey);
    }

    const performanceTable = await queryRunner.getTable('algorithm_performances');
    const performanceForeignKeys = performanceTable.foreignKeys;
    for (const fk of performanceForeignKeys) {
      await queryRunner.dropForeignKey('algorithm_performances', fk);
    }

    const activationTable = await queryRunner.getTable('algorithm_activations');
    const activationForeignKeys = activationTable.foreignKeys;
    for (const fk of activationForeignKeys) {
      await queryRunner.dropForeignKey('algorithm_activations', fk);
    }

    // Drop column
    await queryRunner.dropColumn('order', 'algorithmActivationId');

    // Drop tables
    await queryRunner.dropTable('algorithm_performances');
    await queryRunner.dropTable('algorithm_activations');
  }
}
