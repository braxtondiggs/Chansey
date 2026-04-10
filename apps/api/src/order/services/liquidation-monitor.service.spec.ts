import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MAINTENANCE_MARGIN_RATE } from '@chansey/api-interfaces';

import { LiquidationMonitorService } from './liquidation-monitor.service';

import { CoinService } from '../../coin/coin.service';
import { UserStrategyPosition } from '../../strategy/entities/user-strategy-position.entity';

function createMockPosition(overrides: Partial<Record<string, unknown>> = {}): UserStrategyPosition {
  return {
    id: 'pos-1',
    userId: 'user-1',
    symbol: 'BTCUSDT',
    positionSide: 'long',
    leverage: 5,
    avgEntryPrice: 50000,
    quantity: 0.1,
    liquidationPrice: null,
    marginAmount: 1000,
    unrealizedPnL: 0,
    realizedPnL: 0,
    maintenanceMargin: null,
    strategyConfigId: 'sc-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as unknown as UserStrategyPosition;
}

describe('LiquidationMonitorService', () => {
  let service: LiquidationMonitorService;
  let mockQueryBuilder: Record<string, jest.Mock>;
  let mockPositionRepo: Record<string, jest.Mock>;
  let mockCoinService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0)
    };

    mockPositionRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
    };

    mockCoinService = {
      getCoinBySymbol: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidationMonitorService,
        { provide: getRepositoryToken(UserStrategyPosition), useValue: mockPositionRepo },
        { provide: CoinService, useValue: mockCoinService }
      ]
    }).compile();

    service = module.get<LiquidationMonitorService>(LiquidationMonitorService);
  });

  describe('countLeveragedPositions', () => {
    it('should delegate to repository count query', async () => {
      mockQueryBuilder.getCount.mockResolvedValue(7);

      const result = await service.countLeveragedPositions();

      expect(result).toBe(7);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('p.leverage > 1');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('p.quantity > 0');
    });
  });

  describe('checkLiquidationRisk', () => {
    it('should return empty array when no leveraged positions exist', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const result = await service.checkLiquidationRisk();

      expect(result).toEqual([]);
    });

    it('should classify long position as SAFE and map all fields correctly', async () => {
      const position = createMockPosition();
      mockQueryBuilder.getMany.mockResolvedValue([position]);
      // liqPrice = 50000 * (1 - 0.2 + 0.005) = 40250; distance at 50000 = ~19.5% → SAFE
      mockCoinService.getCoinBySymbol.mockResolvedValue({ currentPrice: 50000 });

      const result = await service.checkLiquidationRisk();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          positionId: 'pos-1',
          userId: 'user-1',
          symbol: 'BTCUSDT',
          positionSide: 'long',
          leverage: 5,
          entryPrice: 50000,
          currentPrice: 50000,
          riskLevel: 'SAFE'
        })
      );
      expect(result[0].liquidationPrice).toBeCloseTo(50000 * (1 - 1 / 5 + MAINTENANCE_MARGIN_RATE), 2);
      expect(result[0].distanceToLiquidation).toBeGreaterThan(0.05);
    });

    it('should classify long position as WARNING when 2% < distance <= 5%', async () => {
      const position = createMockPosition();
      mockQueryBuilder.getMany.mockResolvedValue([position]);
      // liqPrice = 40250; for ~3% distance: 40250 / 0.97 ≈ 41495
      mockCoinService.getCoinBySymbol.mockResolvedValue({ currentPrice: 41495 });

      const result = await service.checkLiquidationRisk();

      expect(result[0].riskLevel).toBe('WARNING');
      expect(result[0].distanceToLiquidation).toBeGreaterThan(0.02);
      expect(result[0].distanceToLiquidation).toBeLessThanOrEqual(0.05);
    });

    it('should classify long position as CRITICAL when distance <= 2%', async () => {
      const position = createMockPosition();
      mockQueryBuilder.getMany.mockResolvedValue([position]);
      // liqPrice = 40250; for ~1% distance: 40250 / 0.99 ≈ 40657
      mockCoinService.getCoinBySymbol.mockResolvedValue({ currentPrice: 40657 });

      const result = await service.checkLiquidationRisk();

      expect(result[0].riskLevel).toBe('CRITICAL');
      expect(result[0].distanceToLiquidation).toBeLessThanOrEqual(0.02);
    });

    it('should use short liquidation formula and inverted distance', async () => {
      const position = createMockPosition({ positionSide: 'short', avgEntryPrice: 50000, leverage: 5 });
      mockQueryBuilder.getMany.mockResolvedValue([position]);
      mockCoinService.getCoinBySymbol.mockResolvedValue({ currentPrice: 50000 });

      const result = await service.checkLiquidationRisk();

      // Short liq = 50000 * (1 + 0.2 - 0.005) = 59750
      const expectedLiqPrice = 50000 * (1 + 1 / 5 - MAINTENANCE_MARGIN_RATE);
      expect(result[0].liquidationPrice).toBeCloseTo(expectedLiqPrice, 2);
      // distance = (59750 - 50000) / 50000 = 0.195
      expect(result[0].distanceToLiquidation).toBeCloseTo(0.195, 2);
      expect(result[0].riskLevel).toBe('SAFE');
    });

    it('should prefer stored liquidation price over calculated', async () => {
      const position = createMockPosition({ liquidationPrice: 42000 });
      mockQueryBuilder.getMany.mockResolvedValue([position]);
      mockCoinService.getCoinBySymbol.mockResolvedValue({ currentPrice: 50000 });

      const result = await service.checkLiquidationRisk();

      expect(result[0].liquidationPrice).toBe(42000);
    });

    it('should skip positions where price fetch returns null', async () => {
      const position = createMockPosition({ symbol: 'UNKNOWNUSDT' });
      mockQueryBuilder.getMany.mockResolvedValue([position]);
      mockCoinService.getCoinBySymbol.mockResolvedValue(null);

      const result = await service.checkLiquidationRisk();

      expect(result).toHaveLength(0);
    });

    it('should deduplicate symbols in batch price fetch', async () => {
      const pos1 = createMockPosition({ id: 'pos-1', symbol: 'BTCUSDT' });
      const pos2 = createMockPosition({ id: 'pos-2', symbol: 'BTCUSDT' });
      mockQueryBuilder.getMany.mockResolvedValue([pos1, pos2]);
      mockCoinService.getCoinBySymbol.mockResolvedValue({ currentPrice: 50000 });

      const result = await service.checkLiquidationRisk();

      expect(mockCoinService.getCoinBySymbol).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
    });

    it('should handle mixed success/failure in batch price fetch', async () => {
      const btcPos = createMockPosition({ id: 'pos-1', symbol: 'BTCUSDT' });
      const ethPos = createMockPosition({ id: 'pos-2', symbol: 'ETHUSDT' });
      mockQueryBuilder.getMany.mockResolvedValue([btcPos, ethPos]);
      mockCoinService.getCoinBySymbol.mockImplementation((symbol: string) => {
        if (symbol === 'BTC') return Promise.resolve({ currentPrice: 50000 });
        return Promise.reject(new Error('Network error'));
      });

      const result = await service.checkLiquidationRisk();

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTCUSDT');
    });
  });

  describe('calculateMarginHealth', () => {
    it('should sum margin across positions and filter out SAFE risks', async () => {
      const safePos = createMockPosition({ id: 'pos-safe', leverage: 2, marginAmount: 1000 });
      const criticalPos = createMockPosition({ id: 'pos-critical', leverage: 10, marginAmount: 2000 });
      mockQueryBuilder.getMany.mockResolvedValue([safePos, criticalPos]);
      // leverage=2 liq=25250 → distance~45% SAFE; leverage=10 liq=45250 → distance~1.6% CRITICAL
      mockCoinService.getCoinBySymbol.mockResolvedValue({ currentPrice: 46000 });

      const result = await service.calculateMarginHealth('user-1');

      expect(result.userId).toBe('user-1');
      expect(result.totalMarginUsed).toBe(3000);
      expect(result.positionsAtRisk.every((r) => r.riskLevel !== 'SAFE')).toBe(true);
      expect(result.positionsAtRisk.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty results for user with no leveraged positions', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const result = await service.calculateMarginHealth('user-empty');

      expect(result.totalMarginUsed).toBe(0);
      expect(result.positionsAtRisk).toEqual([]);
    });
  });
});
