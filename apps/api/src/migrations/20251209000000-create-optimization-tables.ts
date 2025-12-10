import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateOptimizationTables20251209000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create optimization_status enum
    await queryRunner.query(`
      CREATE TYPE "optimization_status_enum" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')
    `);

    // Create optimization_runs table
    await queryRunner.createTable(
      new Table({
        name: 'optimization_runs',
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
            type: 'optimization_status_enum',
            default: "'PENDING'"
          },
          {
            name: 'config',
            type: 'jsonb',
            comment: 'Optimization configuration (search method, walk-forward settings, objective)'
          },
          {
            name: 'parameterSpace',
            type: 'jsonb',
            comment: 'Parameter space definition (parameters, constraints)'
          },
          {
            name: 'baselineParameters',
            type: 'jsonb',
            isNullable: true,
            comment: 'Default parameter values used as baseline'
          },
          {
            name: 'bestParameters',
            type: 'jsonb',
            isNullable: true,
            comment: 'Best parameters found during optimization'
          },
          {
            name: 'baselineScore',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
            comment: 'Score achieved with baseline parameters'
          },
          {
            name: 'bestScore',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
            comment: 'Best score achieved during optimization'
          },
          {
            name: 'improvement',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
            comment: 'Percentage improvement over baseline'
          },
          {
            name: 'combinationsTested',
            type: 'int',
            default: 0,
            comment: 'Number of parameter combinations tested'
          },
          {
            name: 'totalCombinations',
            type: 'int',
            default: 0,
            comment: 'Total number of combinations to test'
          },
          {
            name: 'windowsProcessed',
            type: 'int',
            isNullable: true,
            comment: 'Number of walk-forward windows processed'
          },
          {
            name: 'progressDetails',
            type: 'jsonb',
            isNullable: true,
            comment: 'Progress tracking details'
          },
          {
            name: 'errorMessage',
            type: 'text',
            isNullable: true,
            comment: 'Error message if optimization failed'
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()'
          },
          {
            name: 'startedAt',
            type: 'timestamptz',
            isNullable: true,
            comment: 'When optimization execution started'
          },
          {
            name: 'completedAt',
            type: 'timestamptz',
            isNullable: true,
            comment: 'When optimization completed or failed'
          }
        ]
      })
    );

    // Create indexes for optimization_runs
    await queryRunner.createIndex(
      'optimization_runs',
      new TableIndex({
        name: 'IDX_optimization_runs_strategy_status',
        columnNames: ['strategyConfigId', 'status']
      })
    );

    await queryRunner.createIndex(
      'optimization_runs',
      new TableIndex({
        name: 'IDX_optimization_runs_created',
        columnNames: ['createdAt']
      })
    );

    // Create foreign key for optimization_runs
    await queryRunner.createForeignKey(
      'optimization_runs',
      new TableForeignKey({
        columnNames: ['strategyConfigId'],
        referencedTableName: 'strategy_configs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );

    // Create optimization_results table
    await queryRunner.createTable(
      new Table({
        name: 'optimization_results',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()'
          },
          {
            name: 'optimizationRunId',
            type: 'uuid'
          },
          {
            name: 'combinationIndex',
            type: 'int',
            comment: 'Index of this combination in the search space'
          },
          {
            name: 'parameters',
            type: 'jsonb',
            comment: 'Parameter values for this combination'
          },
          {
            name: 'avgTrainScore',
            type: 'decimal',
            precision: 10,
            scale: 4,
            comment: 'Average score across training windows'
          },
          {
            name: 'avgTestScore',
            type: 'decimal',
            precision: 10,
            scale: 4,
            comment: 'Average score across test windows'
          },
          {
            name: 'avgDegradation',
            type: 'decimal',
            precision: 10,
            scale: 4,
            comment: 'Average degradation from train to test'
          },
          {
            name: 'consistencyScore',
            type: 'decimal',
            precision: 10,
            scale: 4,
            comment: 'Consistency score (0-100) based on variance across windows'
          },
          {
            name: 'overfittingWindows',
            type: 'int',
            comment: 'Number of windows with detected overfitting'
          },
          {
            name: 'windowResults',
            type: 'jsonb',
            comment: 'Detailed results for each walk-forward window'
          },
          {
            name: 'rank',
            type: 'int',
            isNullable: true,
            comment: 'Rank based on test score (1 = best)'
          },
          {
            name: 'isBaseline',
            type: 'boolean',
            default: false,
            comment: 'Whether this is the baseline (default) parameter set'
          },
          {
            name: 'isBest',
            type: 'boolean',
            default: false,
            comment: 'Whether this is the best performing combination'
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()'
          }
        ]
      })
    );

    // Create indexes for optimization_results
    await queryRunner.createIndex(
      'optimization_results',
      new TableIndex({
        name: 'IDX_optimization_results_run_rank',
        columnNames: ['optimizationRunId', 'rank']
      })
    );

    await queryRunner.createIndex(
      'optimization_results',
      new TableIndex({
        name: 'IDX_optimization_results_test_score',
        columnNames: ['avgTestScore']
      })
    );

    // Create foreign key for optimization_results
    await queryRunner.createForeignKey(
      'optimization_results',
      new TableForeignKey({
        columnNames: ['optimizationRunId'],
        referencedTableName: 'optimization_runs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop optimization_results table
    const optimizationResultsTable = await queryRunner.getTable('optimization_results');
    if (optimizationResultsTable) {
      for (const foreignKey of optimizationResultsTable.foreignKeys) {
        await queryRunner.dropForeignKey('optimization_results', foreignKey);
      }
    }
    await queryRunner.dropIndex('optimization_results', 'IDX_optimization_results_test_score');
    await queryRunner.dropIndex('optimization_results', 'IDX_optimization_results_run_rank');
    await queryRunner.dropTable('optimization_results', true);

    // Drop optimization_runs table
    const optimizationRunsTable = await queryRunner.getTable('optimization_runs');
    if (optimizationRunsTable) {
      for (const foreignKey of optimizationRunsTable.foreignKeys) {
        await queryRunner.dropForeignKey('optimization_runs', foreignKey);
      }
    }
    await queryRunner.dropIndex('optimization_runs', 'IDX_optimization_runs_created');
    await queryRunner.dropIndex('optimization_runs', 'IDX_optimization_runs_strategy_status');
    await queryRunner.dropTable('optimization_runs', true);

    // Drop enum
    await queryRunner.query('DROP TYPE IF EXISTS "optimization_status_enum"');
  }
}
