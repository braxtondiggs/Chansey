import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CoinController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';
import { CoinTask } from './coin.task';

import { BinanceService } from '../exchange/binance/binance.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange/exchange.service';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { HealthCheckHelper } from '../utils/health-check.helper';

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
        BinanceService,
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
        HealthCheckHelper,
        CoinTask
      ],
      imports: [ConfigModule, HttpModule]
    }).compile();

    controller = module.get<CoinController>(CoinController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
