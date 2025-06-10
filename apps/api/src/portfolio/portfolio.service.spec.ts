import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Portfolio } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioHistoricalPriceTask } from './tasks/portfolio-historical-price.task';

import { PriceService } from '../price/price.service';

describe('PortfolioService', () => {
  let service: PortfolioService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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

    service = module.get<PortfolioService>(PortfolioService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
