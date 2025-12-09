import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateAuditTables1731686500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create audit_logs table
    await queryRunner.createTable(
      new Table({
        name: 'audit_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'eventType',
            type: 'enum',
            enum: [
              'STRATEGY_CREATED',
              'STRATEGY_UPDATED',
              'STRATEGY_DELETED',
              'BACKTEST_STARTED',
              'BACKTEST_COMPLETED',
              'BACKTEST_FAILED',
              'SCORE_CALCULATED',
              'PROMOTION_REQUESTED',
              'PROMOTION_APPROVED',
              'PROMOTION_REJECTED',
              'DEPLOYMENT_STARTED',
              'DEPLOYMENT_PAUSED',
              'DEPLOYMENT_RESUMED',
              'DEPLOYMENT_DEACTIVATED',
              'ALLOCATION_CHANGED',
              'RISK_LIMIT_CHANGED',
              'DRIFT_DETECTED',
              'DRIFT_ACKNOWLEDGED',
              'REGIME_CHANGED',
              'PARAMETER_CHANGED',
              'MANUAL_INTERVENTION'
            ],
            comment: 'Type of audit event'
          },
          {
            name: 'entityType',
            type: 'varchar',
            length: '100',
            comment: 'Entity type (strategy, deployment, backtest, etc.)'
          },
          {
            name: 'entityId',
            type: 'uuid',
            comment: 'ID of affected entity'
          },
          {
            name: 'userId',
            type: 'uuid',
            isNullable: true,
            comment: 'User who triggered event (nullable for system events)'
          },
          {
            name: 'timestamp',
            type: 'timestamptz',
            default: 'now()'
          },
          {
            name: 'beforeState',
            type: 'jsonb',
            isNullable: true,
            comment: 'State before change (JSON, nullable)'
          },
          {
            name: 'afterState',
            type: 'jsonb',
            isNullable: true,
            comment: 'State after change (JSON, nullable)'
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
            comment: 'Additional event metadata (JSON)'
          },
          {
            name: 'correlationId',
            type: 'uuid',
            isNullable: true,
            comment: 'ID linking related events'
          },
          {
            name: 'integrity',
            type: 'varchar',
            length: '64',
            comment: 'SHA-256 hash for tamper detection'
          },
          {
            name: 'ipAddress',
            type: 'varchar',
            length: '45',
            isNullable: true,
            comment: 'Client IP address (nullable)'
          },
          {
            name: 'userAgent',
            type: 'text',
            isNullable: true,
            comment: 'Client user agent (nullable)'
          }
        ]
      })
    );

    // Create indexes for audit_logs (partitioned by month for efficiency)
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_entity',
        columnNames: ['entityType', 'entityId', 'timestamp']
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_event',
        columnNames: ['eventType', 'timestamp']
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_correlation',
        columnNames: ['correlationId']
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_timestamp',
        columnNames: ['timestamp']
      })
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_user',
        columnNames: ['userId', 'timestamp']
      })
    );

    // Create foreign key for userId
    await queryRunner.createForeignKey(
      'audit_logs',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop audit_logs table
    const auditLogsTable = await queryRunner.getTable('audit_logs');
    if (auditLogsTable) {
      for (const foreignKey of auditLogsTable.foreignKeys) {
        await queryRunner.dropForeignKey('audit_logs', foreignKey);
      }
    }

    // Drop indexes
    await queryRunner.dropIndex('audit_logs', 'IDX_audit_logs_user');
    await queryRunner.dropIndex('audit_logs', 'IDX_audit_logs_timestamp');
    await queryRunner.dropIndex('audit_logs', 'IDX_audit_logs_correlation');
    await queryRunner.dropIndex('audit_logs', 'IDX_audit_logs_event');
    await queryRunner.dropIndex('audit_logs', 'IDX_audit_logs_entity');

    // Drop table
    await queryRunner.dropTable('audit_logs', true);

    // Drop enum
    await queryRunner.query('DROP TYPE IF EXISTS "audit_logs_eventType_enum"');
  }
}
