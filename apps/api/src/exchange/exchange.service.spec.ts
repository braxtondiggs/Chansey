import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangeKeyService } from './exchange-key/exchange-key.service';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';

describe('ExchangeService', () => {
  let service: ExchangeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeService,
        {
          provide: getRepositoryToken(Exchange),
          useValue: {
            find: vi.fn(() => []),
            findOne: vi.fn(() => ({})),
            save: vi.fn(() => ({})),
            update: vi.fn(() => ({})),
            delete: vi.fn(() => ({}))
          }
        },
        {
          provide: ExchangeKeyService,
          useValue: {
            findAll: vi.fn(() => []),
            findOne: vi.fn(() => ({})),
            findByExchange: vi.fn(() => []),
            create: vi.fn(() => ({})),
            update: vi.fn(() => ({})),
            remove: vi.fn(() => ({}))
          }
        },
        {
          provide: 'BullQueue_exchange-queue',
          useValue: {
            add: vi.fn(),
            getRepeatableJobs: vi.fn()
            // Add other methods as needed for your tests
          }
        }
      ]
    }).compile();

    service = module.get<ExchangeService>(ExchangeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
