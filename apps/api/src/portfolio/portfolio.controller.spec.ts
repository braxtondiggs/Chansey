import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortfolioController } from './portfolio.controller';
import { Portfolio } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioHistoricalPriceTask } from './tasks/portfolio-historical-price.task';

import { PriceService } from '../price/price.service';

describe('PortfolioController', () => {
  let controller: PortfolioController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortfolioController],
      providers: [
        PortfolioService,
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
          provide: PortfolioHistoricalPriceTask,
          useValue: {
            addUpdateHistoricalPriceJob: vi.fn(),
            process: vi.fn()
          }
        },
        {
          provide: PriceService,
          useValue: {
            getPriceByTimeframe: vi.fn(() => []),
            getLatestPrice: vi.fn(() => ({})),
            createPrice: vi.fn(() => ({}))
          }
        }
      ]
    }).compile();

    controller = module.get<PortfolioController>(PortfolioController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
