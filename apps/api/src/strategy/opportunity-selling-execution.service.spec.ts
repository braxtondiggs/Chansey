import { Test, type TestingModule } from '@nestjs/testing';

import { type UserStrategyPosition } from './entities/user-strategy-position.entity';
import { OpportunitySellingExecutionService } from './opportunity-selling-execution.service';
import { PositionTrackingService } from './position-tracking.service';

import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { ExchangeSelectionService } from '../exchange/exchange-selection/exchange-selection.service';
import { MetricsService } from '../metrics/metrics.service';
import { OpportunitySellDecision } from '../order/interfaces/opportunity-selling.interface';
import { OrderService } from '../order/order.service';
import { OpportunitySellService } from '../order/services/opportunity-sell.service';
import { TradeCooldownService } from '../shared/trade-cooldown.service';
import { type User } from '../users/users.entity';

const createUser = (overrides: Record<string, unknown> = {}): User =>
  ({
    id: 'user-1',
    enableOpportunitySelling: true,
    opportunitySellingConfig: {},
    ...overrides
  }) as User;

const createOppSellResult = (overrides: Record<string, unknown> = {}) => ({
  decision: OpportunitySellDecision.APPROVED,
  sellOrders: [{ coinId: 'ETH', quantity: 0.5, currentPrice: 2000, estimatedProceeds: 1000, score: {} as any }],
  reason: 'Selling 1 position(s)',
  projectedProceeds: 1000,
  buySignalCoinId: 'BTC',
  buySignalConfidence: 0.8,
  shortfall: 200,
  availableCash: 100,
  portfolioValue: 5000,
  evaluatedPositions: [],
  liquidationPercent: 20,
  ...overrides
});

const marketData = [
  { symbol: 'BTC/USDT', price: 30000, timestamp: new Date() },
  { symbol: 'ETH/USDT', price: 2000, timestamp: new Date() }
];

describe('OpportunitySellingExecutionService', () => {
  let service: OpportunitySellingExecutionService;
  let opportunitySellService: jest.Mocked<OpportunitySellService>;
  let exchangeSelectionService: jest.Mocked<ExchangeSelectionService>;
  let tradeCooldownService: jest.Mocked<TradeCooldownService>;
  let orderService: jest.Mocked<OrderService>;
  let positionTracking: jest.Mocked<PositionTrackingService>;
  let exchangeManager: jest.Mocked<ExchangeManagerService>;

  beforeEach(async () => {
    opportunitySellService = {
      evaluateAndPersist: jest.fn().mockResolvedValue(createOppSellResult())
    } as unknown as jest.Mocked<OpportunitySellService>;

    exchangeSelectionService = {
      selectForSell: jest.fn().mockResolvedValue({ id: 'ek-1', name: 'Binance US' })
    } as unknown as jest.Mocked<ExchangeSelectionService>;

    tradeCooldownService = {
      checkAndClaim: jest.fn().mockResolvedValue({ allowed: true }),
      clearCooldown: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<TradeCooldownService>;

    orderService = {
      placeAlgorithmicOrder: jest.fn().mockResolvedValue({ id: 'sell-order-1' })
    } as unknown as jest.Mocked<OrderService>;

    positionTracking = {
      updatePosition: jest.fn()
    } as unknown as jest.Mocked<PositionTrackingService>;

    exchangeManager = {
      getPrice: jest.fn()
    } as unknown as jest.Mocked<ExchangeManagerService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpportunitySellingExecutionService,
        { provide: OpportunitySellService, useValue: opportunitySellService },
        { provide: ExchangeSelectionService, useValue: exchangeSelectionService },
        { provide: TradeCooldownService, useValue: tradeCooldownService },
        { provide: OrderService, useValue: orderService },
        { provide: PositionTrackingService, useValue: positionTracking },
        { provide: MetricsService, useValue: { recordLiveOrderPlaced: jest.fn() } },
        { provide: ExchangeManagerService, useValue: exchangeManager }
      ]
    }).compile();

    service = module.get(OpportunitySellingExecutionService);
    // Mock fetchMarketData to avoid real exchange calls
    jest.spyOn(service, 'fetchMarketData').mockResolvedValue(marketData);
  });

  const user = createUser();
  const buySignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000, confidence: 0.8 } as any;

  const longPositions: UserStrategyPosition[] = [
    {
      id: 'pos-1',
      symbol: 'ETH/USDT',
      positionSide: 'long',
      quantity: '1.0',
      avgEntryPrice: '1800',
      strategyConfigId: 'strategy-1',
      createdAt: new Date()
    } as any
  ];

  describe('regime guard', () => {
    it.each(['BEAR', 'EXTREME'])('skips opportunity selling in %s regime', async (regime) => {
      const result = await service.execute(user, buySignal, 'strategy-1', regime, longPositions, marketData, 300, 100);

      expect(result.freed).toBe(false);
      expect(result.reason).toContain('too risky for liquidation');
      expect(opportunitySellService.evaluateAndPersist).not.toHaveBeenCalled();
    });

    it.each(['BULL', 'NEUTRAL'])('allows opportunity selling in %s regime', async (regime) => {
      const result = await service.execute(user, buySignal, 'strategy-1', regime, longPositions, marketData, 300, 100);

      expect(opportunitySellService.evaluateAndPersist).toHaveBeenCalled();
      expect(result.freed).toBe(true);
    });
  });

  describe('position filtering', () => {
    it('excludes short positions from the position map', async () => {
      const mixedPositions = [
        ...longPositions,
        {
          id: 'pos-2',
          symbol: 'ETH/USDT',
          positionSide: 'short',
          quantity: '0.5',
          avgEntryPrice: '2100',
          strategyConfigId: 'strategy-1',
          createdAt: new Date()
        } as any
      ];

      await service.execute(user, buySignal, 'strategy-1', 'BULL', mixedPositions, marketData, 300, 100);

      const callArgs = opportunitySellService.evaluateAndPersist.mock.calls[0][0];
      const posMap = callArgs.positions as Map<string, any>;
      expect(posMap.get('ETH')?.quantity).toBe(1.0);
    });

    it('keeps earliest entryDate when merging positions for same coin', async () => {
      const earlierDate = new Date('2025-01-01');
      const laterDate = new Date('2025-06-01');

      const multiPositions = [
        {
          id: 'pos-1',
          symbol: 'ETH/USDT',
          positionSide: 'long',
          quantity: '1.0',
          avgEntryPrice: '1800',
          strategyConfigId: 'strategy-1',
          createdAt: laterDate
        } as any,
        {
          id: 'pos-2',
          symbol: 'ETH/USDT',
          positionSide: 'long',
          quantity: '0.5',
          avgEntryPrice: '2000',
          strategyConfigId: 'strategy-1',
          createdAt: earlierDate
        } as any
      ];

      await service.execute(user, buySignal, 'strategy-1', 'BULL', multiPositions, marketData, 300, 100);

      const callArgs = opportunitySellService.evaluateAndPersist.mock.calls[0][0];
      const posMap = callArgs.positions as Map<string, any>;
      expect(posMap.get('ETH')?.entryDate).toEqual(earlierDate);
    });
  });

  describe('sell execution', () => {
    it('returns freed=false when evaluator rejects', async () => {
      opportunitySellService.evaluateAndPersist.mockResolvedValue(
        createOppSellResult({
          decision: OpportunitySellDecision.REJECTED_LOW_CONFIDENCE,
          sellOrders: [],
          projectedProceeds: 0
        })
      );

      const result = await service.execute(user, buySignal, 'strategy-1', 'BULL', longPositions, marketData, 300, 100);

      expect(result.freed).toBe(false);
    });

    it('returns freed=true after successful sell execution', async () => {
      const result = await service.execute(user, buySignal, 'strategy-1', 'BULL', longPositions, marketData, 300, 100);

      expect(result.freed).toBe(true);
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.objectContaining({ action: 'sell', symbol: 'ETH/USDT', quantity: 0.5 }),
        'ek-1'
      );
    });

    it('uses source position strategyConfigId for sell orders', async () => {
      const positions = [
        {
          id: 'pos-1',
          symbol: 'ETH/USDT',
          positionSide: 'long',
          quantity: '1.0',
          avgEntryPrice: '1800',
          strategyConfigId: 'strategy-A',
          createdAt: new Date()
        } as any
      ];

      await service.execute(user, buySignal, 'strategy-B', 'BULL', positions, marketData, 300, 100);

      // Sell should use strategy-A (the position owner), not strategy-B (the buyer)
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(
        'user-1',
        'strategy-A',
        expect.anything(),
        'ek-1'
      );
      expect(positionTracking.updatePosition).toHaveBeenCalledWith(
        'user-1',
        'strategy-A',
        'ETH/USDT',
        0.5,
        2000,
        'sell',
        'long'
      );
    });
  });

  describe('multi-coin position tracking', () => {
    it('tracks remainingQty independently per coin across sell orders', async () => {
      opportunitySellService.evaluateAndPersist.mockResolvedValue(
        createOppSellResult({
          sellOrders: [
            { coinId: 'ETH', quantity: 0.5, currentPrice: 2000, estimatedProceeds: 1000, score: {} as any },
            { coinId: 'SOL', quantity: 3, currentPrice: 100, estimatedProceeds: 300, score: {} as any }
          ],
          projectedProceeds: 1300
        })
      );

      jest
        .spyOn(service, 'fetchMarketData')
        .mockResolvedValue([...marketData, { symbol: 'SOL/USDT', price: 100, timestamp: new Date() }]);

      const positions = [
        {
          id: 'pos-1',
          symbol: 'ETH/USDT',
          positionSide: 'long',
          quantity: '1.0',
          avgEntryPrice: '1800',
          strategyConfigId: 'strategy-A',
          createdAt: new Date()
        } as any,
        {
          id: 'pos-2',
          symbol: 'SOL/USDT',
          positionSide: 'long',
          quantity: '5.0',
          avgEntryPrice: '90',
          strategyConfigId: 'strategy-B',
          createdAt: new Date()
        } as any
      ];

      const result = await service.execute(user, buySignal, 'strategy-1', 'BULL', positions, marketData, 300, 100);

      expect(result.freed).toBe(true);
      // ETH sell tracked against strategy-A
      expect(positionTracking.updatePosition).toHaveBeenCalledWith(
        'user-1',
        'strategy-A',
        'ETH/USDT',
        0.5,
        2000,
        'sell',
        'long'
      );
      // SOL sell tracked against strategy-B (not strategy-A — separate coin map)
      expect(positionTracking.updatePosition).toHaveBeenCalledWith(
        'user-1',
        'strategy-B',
        'SOL/USDT',
        3,
        100,
        'sell',
        'long'
      );
    });
  });

  describe('orphaned sell cleanup', () => {
    it('clears cooldowns for orphaned sells on partial sell failure', async () => {
      opportunitySellService.evaluateAndPersist.mockResolvedValue(
        createOppSellResult({
          sellOrders: [
            { coinId: 'ETH', quantity: 0.5, currentPrice: 2000, estimatedProceeds: 1000, score: {} as any },
            { coinId: 'SOL', quantity: 5, currentPrice: 100, estimatedProceeds: 500, score: {} as any }
          ],
          projectedProceeds: 1500
        })
      );

      jest
        .spyOn(service, 'fetchMarketData')
        .mockResolvedValue([...marketData, { symbol: 'SOL/USDT', price: 100, timestamp: new Date() }]);

      // First sell succeeds, second fails
      orderService.placeAlgorithmicOrder
        .mockResolvedValueOnce({ id: 'sell-order-1' } as any)
        .mockRejectedValueOnce(new Error('Exchange error'));

      const positions = [
        ...longPositions,
        {
          id: 'pos-3',
          symbol: 'SOL/USDT',
          positionSide: 'long',
          quantity: '5.0',
          avgEntryPrice: '90',
          strategyConfigId: 'strategy-1',
          createdAt: new Date()
        } as any
      ];

      const result = await service.execute(user, buySignal, 'strategy-1', 'BULL', positions, marketData, 300, 100);

      expect(result.freed).toBe(false);
      // SOL sell failed → its cooldown cleared in the catch
      expect(tradeCooldownService.clearCooldown).toHaveBeenCalledWith('user-1', 'SOL/USDT', 'SELL');
      // ETH sell succeeded but orphaned → cooldown cleared
      expect(tradeCooldownService.clearCooldown).toHaveBeenCalledWith('user-1', 'ETH/USDT', 'SELL');
    });
  });
});
