import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

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
            find: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            save: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            delete: jest.fn(() => ({}))
          }
        },
        {
          provide: PortfolioHistoricalPriceTask,
          useValue: {
            addUpdateHistoricalPriceJob: jest.fn(),
            process: jest.fn()
          }
        },
        {
          provide: PriceService,
          useValue: {
            getPriceByTimeframe: jest.fn(() => []),
            getLatestPrice: jest.fn(() => ({})),
            createPrice: jest.fn(() => ({}))
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
