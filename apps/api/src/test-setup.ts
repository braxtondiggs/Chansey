// Polyfill globalThis.crypto for Jest's node environment
// Required by @nestjs/typeorm's generateString utility
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: require('node:crypto').webcrypto });
}

import * as dotenv from 'dotenv';

import { join } from 'path';

// Load .env.example as base configuration (single source of truth)
// process.cwd() is workspace root in Nx
dotenv.config({ path: join(process.cwd(), '.env.example') });

// Override for test environment only
process.env.NODE_ENV = 'test';

// Mock pg driver globally to prevent real PostgreSQL connections
jest.mock('pg', () => {
  const mockPool = {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    }),
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn()
  };
  return {
    Pool: jest.fn(() => mockPool),
    Client: jest.fn(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ rows: [] }),
      end: jest.fn().mockResolvedValue(undefined),
      on: jest.fn()
    }))
  };
});

// Mock ioredis globally for DistributedLockService and BullMQ
jest.mock('ioredis', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const EventEmitter = require('events');

  class MockRedis extends EventEmitter {
    status = 'ready';

    constructor() {
      super();
      setTimeout(() => this.emit('ready'), 0);
    }

    set = jest.fn().mockResolvedValue('OK');
    get = jest.fn().mockResolvedValue(null);
    del = jest.fn().mockResolvedValue(1);
    pttl = jest.fn().mockResolvedValue(-2);
    eval = jest.fn().mockResolvedValue(1);
    evalsha = jest.fn().mockResolvedValue(1);
    quit = jest.fn().mockResolvedValue(undefined);
    disconnect = jest.fn();
    connect = jest.fn().mockResolvedValue(undefined);
    duplicate = jest.fn().mockImplementation(() => new MockRedis());
    defineCommand = jest.fn();
    pipeline = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([])
    });
    multi = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([])
    });
    keys = jest.fn().mockResolvedValue([]);
    scan = jest.fn().mockResolvedValue(['0', []]);
    info = jest.fn().mockResolvedValue('# Server\nredis_version:7.0.0\n');
    client = jest.fn().mockResolvedValue('OK');
  }

  return {
    __esModule: true,
    default: MockRedis,
    Redis: MockRedis
  };
});

// Mock @keyv/redis globally for SharedCacheModule
jest.mock('@keyv/redis', () => {
  const mockKeyvInstance = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn()
  };

  return {
    Keyv: jest.fn().mockImplementation(() => mockKeyvInstance),
    createKeyv: jest.fn().mockReturnValue(mockKeyvInstance)
  };
});
