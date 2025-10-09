import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddManualOrderSupport1728760000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add is_manual column to order table
    await queryRunner.addColumn(
      'order',
      new TableColumn({
        name: 'is_manual',
        type: 'boolean',
        default: false,
        isNullable: false
      })
    );

    // Add trailing_amount column for trailing stop orders
    await queryRunner.addColumn(
      'order',
      new TableColumn({
        name: 'trailing_amount',
        type: 'decimal',
        precision: 20,
        scale: 8,
        isNullable: true
      })
    );

    // Add trailing_type column (AMOUNT or PERCENTAGE)
    await queryRunner.addColumn(
      'order',
      new TableColumn({
        name: 'trailing_type',
        type: 'varchar',
        length: '20',
        isNullable: true
      })
    );

    // Add oco_linked_order_id column for OCO (One-Cancels-Other) orders
    await queryRunner.addColumn(
      'order',
      new TableColumn({
        name: 'oco_linked_order_id',
        type: 'uuid',
        isNullable: true
      })
    );

    // Add exchange_key_id column to link orders to specific exchange keys
    await queryRunner.addColumn(
      'order',
      new TableColumn({
        name: 'exchange_key_id',
        type: 'uuid',
        isNullable: true
      })
    );

    // Create index for filtering manual vs automated orders
    await queryRunner.createIndex(
      'order',
      new TableIndex({
        name: 'idx_orders_manual',
        columnNames: ['is_manual']
      })
    );

    // Create composite index for user and status filtering (performance optimization)
    await queryRunner.createIndex(
      'order',
      new TableIndex({
        name: 'idx_orders_user_status',
        columnNames: ['userId', 'status']
      })
    );

    // Create composite index for user and order type filtering
    await queryRunner.createIndex(
      'order',
      new TableIndex({
        name: 'idx_orders_user_type',
        columnNames: ['userId', 'type']
      })
    );

    // Create index for exchange key filtering
    await queryRunner.createIndex(
      'order',
      new TableIndex({
        name: 'idx_orders_exchange_key',
        columnNames: ['exchange_key_id']
      })
    );

    // Create index for OCO linked orders
    await queryRunner.createIndex(
      'order',
      new TableIndex({
        name: 'idx_orders_oco_linked',
        columnNames: ['oco_linked_order_id']
      })
    );

    // Add check constraint to prevent manual orders from having algorithm activation
    await queryRunner.query(`
      ALTER TABLE "order" ADD CONSTRAINT "CHK_manual_order_no_algorithm"
      CHECK (
        (is_manual = true AND "algorithmActivationId" IS NULL) OR
        (is_manual = false)
      )
    `);

    // Add check constraint for trailing stop parameters
    await queryRunner.query(`
      ALTER TABLE "order" ADD CONSTRAINT "CHK_trailing_stop_params"
      CHECK (
        (type = 'TRAILING_STOP_MARKET' AND trailing_amount IS NOT NULL AND trailing_type IS NOT NULL) OR
        (type != 'TRAILING_STOP_MARKET')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop check constraints
    await queryRunner.query(`ALTER TABLE "order" DROP CONSTRAINT IF EXISTS "CHK_trailing_stop_params"`);
    await queryRunner.query(`ALTER TABLE "order" DROP CONSTRAINT IF EXISTS "CHK_manual_order_no_algorithm"`);

    // Drop indexes
    await queryRunner.dropIndex('order', 'idx_orders_oco_linked');
    await queryRunner.dropIndex('order', 'idx_orders_exchange_key');
    await queryRunner.dropIndex('order', 'idx_orders_user_type');
    await queryRunner.dropIndex('order', 'idx_orders_user_status');
    await queryRunner.dropIndex('order', 'idx_orders_manual');

    // Drop columns
    await queryRunner.dropColumn('order', 'exchange_key_id');
    await queryRunner.dropColumn('order', 'oco_linked_order_id');
    await queryRunner.dropColumn('order', 'trailing_type');
    await queryRunner.dropColumn('order', 'trailing_amount');
    await queryRunner.dropColumn('order', 'is_manual');
  }
}
