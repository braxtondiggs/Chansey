// TypeORM DataSource mock - prevents actual database initialization
const mockQueryRunner = {
  connect: jest.fn().mockResolvedValue(undefined),
  startTransaction: jest.fn().mockResolvedValue(undefined),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  rollbackTransaction: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue([]),
  manager: {}
};

const mockEntityManager = {
  transaction: jest.fn().mockImplementation((cb) => cb(mockEntityManager)),
  query: jest.fn().mockResolvedValue([]),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
  remove: jest.fn().mockResolvedValue(undefined),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    execute: jest.fn().mockResolvedValue(undefined)
  })
};

const mockRepository = {
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
  remove: jest.fn().mockResolvedValue(undefined),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    execute: jest.fn().mockResolvedValue(undefined)
  }),
  metadata: {
    columns: [],
    relations: []
  },
  manager: mockEntityManager
};

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');

  // Create a mock DataSource class that satisfies @nestjs/typeorm requirements
  class MockDataSource {
    isInitialized = true;
    entityMetadatas = [];
    entityMetadatasMap = new Map();
    options = {
      type: 'postgres',
      entities: []
    };
    manager = mockEntityManager;
    driver = {
      isReleased: false
    };
    namingStrategy = {};

    initialize = jest.fn().mockResolvedValue(this);
    destroy = jest.fn().mockResolvedValue(undefined);
    synchronize = jest.fn().mockResolvedValue(undefined);
    runMigrations = jest.fn().mockResolvedValue([]);
    createQueryRunner = jest.fn().mockReturnValue(mockQueryRunner);
    getRepository = jest.fn().mockReturnValue(mockRepository);
    getMetadata = jest.fn().mockReturnValue({
      columns: [],
      relations: [],
      tableName: 'mock_table',
      primaryColumns: [],
      target: class MockEntity {}
    });
    hasMetadata = jest.fn().mockReturnValue(false);
    transaction = jest.fn().mockImplementation((cb) => cb(mockEntityManager));
  }

  return {
    ...actual,
    DataSource: MockDataSource
  };
});

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppController } from './app.controller';
import { AppModule } from './app.module';
import { AppService } from './app.service';

/**
 * Validates that all NestJS dependency injection is correctly configured.
 * Catches module import/export issues and missing providers that would
 * otherwise only surface at runtime (e.g., UnknownDependenciesException).
 *
 * External dependencies (PostgreSQL, Redis) are mocked in test-setup.ts
 * to validate DI configuration without requiring real infrastructure.
 */
describe('AppModule', () => {
  // Suppress NestJS logs during test
  beforeAll(() => {
    Logger.overrideLogger(['error']);
  });

  it('should compile all modules without DI errors', async () => {
    let module;
    try {
      module = await Test.createTestingModule({
        imports: [AppModule]
      }).compile();

      expect(module).toBeDefined();
      expect(module.get(AppController)).toBeInstanceOf(AppController);
      expect(module.get(AppService)).toBeInstanceOf(AppService);
    } catch (error: unknown) {
      // Log detailed error for debugging
      console.error('Module compilation failed:', error);
      console.error('Error name:', error instanceof Error ? error.name : 'unknown');
      console.error('Error message:', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.cause) {
        console.error('Cause:', error.cause);
      }
      throw error;
    } finally {
      if (module) {
        await module.close();
      }
    }
  }, 60000);
});
