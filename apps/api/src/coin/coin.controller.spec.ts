import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CoinController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';

import { ExchangeService } from '../exchange/exchange.service';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PriceService } from '../price/price.service';

describe('CoinController', () => {
  let controller: CoinController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoinController],
      providers: [
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
        {
          provide: getRepositoryToken(Portfolio),
          useValue: {
            find: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            save: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            delete: jest.fn(() => ({}))
          }
        },
        {
          provide: ExchangeService,
          useValue: {
            findAll: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            findBySlug: jest.fn(() => ({})),
            create: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            remove: jest.fn(() => ({}))
          }
        },
        PortfolioService,
        {
          provide: PriceService,
          useValue: {
            getPrices: jest.fn(() => []),
            getPrice: jest.fn(() => ({})),
            getPriceBySymbol: jest.fn(() => ({})),
            createPrice: jest.fn(() => ({})),
            getSummary: jest.fn(() => [])
          }
        },
        {
          provide: 'BullQueue_coin-queue',
          useValue: {
            add: jest.fn(),
            getRepeatableJobs: jest.fn()
            // Add other methods as needed for your tests
          }
        },
        {
          provide: 'BullQueue_ticker-pairs-queue',
          useValue: {
            add: jest.fn(),
            getRepeatableJobs: jest.fn()
            // Add other methods as needed for your tests
          }
        }
      ],
      imports: [ConfigModule, HttpModule]
    }).compile();

    controller = module.get<CoinController>(CoinController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
