import { Test, TestingModule } from '@nestjs/testing';

import { PortfolioAggregationService } from './portfolio-aggregation.service';
import { PortfolioType } from './portfolio-type.enum';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

import { UserPerformanceService } from '../strategy/user-performance.service';

describe('PortfolioController', () => {
  let controller: PortfolioController;
  let portfolioService: jest.Mocked<PortfolioService>;
  let aggregationService: jest.Mocked<PortfolioAggregationService>;
  let performanceService: jest.Mocked<UserPerformanceService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com'
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortfolioController],
      providers: [
        {
          provide: PortfolioService,
          useValue: {
            getPortfolioByUser: jest.fn(),
            getPortfolioById: jest.fn(),
            createPortfolioItem: jest.fn(),
            updatePortfolioItem: jest.fn(),
            deletePortfolioItem: jest.fn()
          }
        },
        {
          provide: PortfolioAggregationService,
          useValue: {
            getAggregatedPortfolio: jest.fn(),
            getPositionsByStrategy: jest.fn(),
            getAllocationBreakdown: jest.fn()
          }
        },
        {
          provide: UserPerformanceService,
          useValue: {
            getUserAlgoPerformance: jest.fn(),
            getPerformanceByStrategy: jest.fn()
          }
        }
      ]
    }).compile();

    controller = module.get<PortfolioController>(PortfolioController);
    portfolioService = module.get(PortfolioService) as jest.Mocked<PortfolioService>;
    aggregationService = module.get(PortfolioAggregationService) as jest.Mocked<PortfolioAggregationService>;
    performanceService = module.get(UserPerformanceService) as jest.Mocked<UserPerformanceService>;
  });

  it('gets portfolio items with optional type filter', async () => {
    portfolioService.getPortfolioByUser.mockResolvedValue([{ id: 'portfolio-1' }] as any);

    const result = await controller.getPortfolio(mockUser as any, PortfolioType.MANUAL);

    expect(result).toEqual([{ id: 'portfolio-1' }]);
    expect(portfolioService.getPortfolioByUser).toHaveBeenCalledWith(mockUser, undefined, PortfolioType.MANUAL);
  });

  it('gets portfolio item by id', async () => {
    portfolioService.getPortfolioById.mockResolvedValue({ id: 'portfolio-1' } as any);

    const result = await controller.getPortfolioById('portfolio-1', mockUser as any);

    expect(result).toEqual({ id: 'portfolio-1' });
    expect(portfolioService.getPortfolioById).toHaveBeenCalledWith('portfolio-1', mockUser.id);
  });

  it('creates, updates, and deletes portfolio items', async () => {
    portfolioService.createPortfolioItem.mockResolvedValue({ id: 'portfolio-1' } as any);
    portfolioService.updatePortfolioItem.mockResolvedValue({ id: 'portfolio-1', label: 'Updated' } as any);
    portfolioService.deletePortfolioItem.mockResolvedValue({ success: true } as any);

    const createResult = await controller.createPortfolioItem({ label: 'My Holdings' } as any, mockUser as any);
    const updateResult = await controller.updatePortfolioItem(
      'portfolio-1',
      { label: 'Updated' } as any,
      mockUser as any
    );
    const deleteResult = await controller.deletePortfolioItem('portfolio-1', mockUser as any);

    expect(createResult).toEqual({ id: 'portfolio-1' });
    expect(updateResult).toEqual({ id: 'portfolio-1', label: 'Updated' });
    expect(deleteResult).toEqual({ success: true });
    expect(portfolioService.createPortfolioItem).toHaveBeenCalledWith({ label: 'My Holdings' }, mockUser);
    expect(portfolioService.updatePortfolioItem).toHaveBeenCalledWith('portfolio-1', mockUser.id, {
      label: 'Updated'
    });
    expect(portfolioService.deletePortfolioItem).toHaveBeenCalledWith('portfolio-1', mockUser.id);
  });

  it.each([
    ['getAlgoPortfolio', 'getAggregatedPortfolio', {}],
    ['getAlgoPerformance', 'getUserAlgoPerformance', { totalPnl: 120 }],
    ['getAlgoPositions', 'getPositionsByStrategy', []],
    ['getPerformanceByStrategy', 'getPerformanceByStrategy', []],
    ['getAllocationBreakdown', 'getAllocationBreakdown', { BTC: 0.7 }]
  ])('returns algo data from %s', async (method, serviceMethod, resultValue) => {
    const methodMap = {
      getAggregatedPortfolio: aggregationService.getAggregatedPortfolio,
      getPositionsByStrategy: aggregationService.getPositionsByStrategy,
      getAllocationBreakdown: aggregationService.getAllocationBreakdown,
      getUserAlgoPerformance: performanceService.getUserAlgoPerformance,
      getPerformanceByStrategy: performanceService.getPerformanceByStrategy
    } as const;

    methodMap[serviceMethod].mockResolvedValue(resultValue as any);

    const result = await (controller as any)[method](mockUser as any);

    expect(result).toEqual(resultValue);
    expect(methodMap[serviceMethod]).toHaveBeenCalledWith(mockUser.id);
  });
});
