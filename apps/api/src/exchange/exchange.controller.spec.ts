import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ExchangeKeyService } from './exchange-key/exchange-key.service';
import { ExchangeController } from './exchange.controller';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';

describe('ExchangeController', () => {
  let controller: ExchangeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExchangeController],
      providers: [
        ExchangeService,
        {
          provide: getRepositoryToken(Exchange),
          useValue: {
            find: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            save: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            delete: jest.fn(() => ({}))
          }
        },
        {
          provide: ExchangeKeyService,
          useValue: {
            findAll: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            findByExchange: jest.fn(() => []),
            create: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            remove: jest.fn(() => ({}))
          }
        },
        {
          provide: 'BullQueue_exchange-queue',
          useValue: {
            add: jest.fn(),
            getRepeatableJobs: jest.fn()
            // Add other methods as needed for your tests
          }
        }
      ]
    }).compile();

    controller = module.get<ExchangeController>(ExchangeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
