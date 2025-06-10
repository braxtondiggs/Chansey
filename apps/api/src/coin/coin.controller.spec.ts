import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoinController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';

import { ExchangeService } from '../exchange/exchange.service';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PortfolioHistoricalPriceTask } from '../portfolio/tasks/portfolio-historical-price.task';
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
            find: vi.fn(() => []),
            findOne: vi.fn(() => ({})),
            save: vi.fn(() => ({})),
            update: vi.fn(() => ({})),
            delete: vi.fn(() => ({}))
          }
        },
        {
          provide: getRepositoryToken(Portfolio),
          useValue: {
            find: vi.fn(() => []),
            findOne: vi.fn(() => ({})),
            save: vi.fn(() => ({})),
            update: vi.fn(() => ({})),
            delete: vi.fn(() => ({}))
          }
        },
        {
          provide: ExchangeService,
          useValue: {
            findAll: vi.fn(() => []),
            findOne: vi.fn(() => ({})),
            findBySlug: vi.fn(() => ({})),
            create: vi.fn(() => ({})),
            update: vi.fn(() => ({})),
            remove: vi.fn(() => ({}))
          }
        },
        PortfolioService,
        {
          provide: PortfolioHistoricalPriceTask,
          useValue: {
            addUpdateHistoricalPriceJob: vi.fn(),
            process: vi.fn()
          }
        },
        {
          provide: PriceService,
          useValue: {
            getPrices: vi.fn(() => []),
            getPrice: vi.fn(() => ({})),
            getPriceBySymbol: vi.fn(() => ({})),
            createPrice: vi.fn(() => ({})),
            getSummary: vi.fn(() => [])
          }
        },
        {
          provide: 'BullQueue_coin-queue',
          useValue: {
            add: vi.fn(),
            getRepeatableJobs: vi.fn()
            // Add other methods as needed for your tests
          }
        },
        {
          provide: 'BullQueue_ticker-pairs-queue',
          useValue: {
            add: vi.fn(),
            getRepeatableJobs: vi.fn()
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
