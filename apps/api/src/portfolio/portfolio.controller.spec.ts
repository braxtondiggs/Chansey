import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PortfolioAggregationService } from './portfolio-aggregation.service';
import { PortfolioController } from './portfolio.controller';
import { Portfolio } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioHistoricalPriceTask } from './tasks/portfolio-historical-price.task';

import { PriceService } from '../price/price.service';
import { UserPerformanceService } from '../strategy/user-performance.service';

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
        },
        {
          provide: PortfolioAggregationService,
          useValue: {
            getAggregatedPortfolio: jest.fn(() => ({})),
            getPositionsByStrategy: jest.fn(() => []),
            getAllocationBreakdown: jest.fn(() => ({}))
          }
        },
        {
          provide: UserPerformanceService,
          useValue: {
            getUserAlgoPerformance: jest.fn(() => ({})),
            getPerformanceByStrategy: jest.fn(() => [])
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
