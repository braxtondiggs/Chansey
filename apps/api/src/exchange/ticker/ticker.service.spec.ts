import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Ticker } from './ticker.entity';
import { TickerService } from './ticker.service';
import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { Exchange } from '../exchange.entity';
import { ExchangeService } from '../exchange.service';

describe('TickerService', () => {
  let service: TickerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TickerService,
        {
          provide: getRepositoryToken(Ticker),
          useValue: {
            find: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            save: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            delete: jest.fn(() => ({}))
          }
        },
        CoinService,
        {
          provide: getRepositoryToken(Coin),
          useValue: {
            find: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            save: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            delete: jest.fn(() => ({}))
          }
        },
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
        }
      ]
    }).compile();

    service = module.get<TickerService>(TickerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
