import { Test, type TestingModule } from '@nestjs/testing';

import { SignalReasonCode } from '@chansey/api-interfaces';

import { OrderPlacementService } from './order-placement.service';
import { PositionTrackingService } from './position-tracking.service';
import { type TradingSignal } from './strategy-executor.service';

import { ExchangeSelectionService } from '../exchange/exchange-selection/exchange-selection.service';
import { MetricsService } from '../metrics/metrics.service';
import { OrderService } from '../order/order.service';
import { TradeExecutionService } from '../order/services/trade-execution.service';
import { TradeCooldownService } from '../shared/trade-cooldown.service';
import { type User } from '../users/users.entity';

const createUser = (overrides: Record<string, unknown> = {}): User =>
  ({
    id: 'user-1',
    algoTradingEnabled: true,
    algoCapitalAllocationPercentage: 50,
    coinRisk: { level: 3 } as any,
    effectiveCalculationRiskLevel: 3,
    ...overrides
  }) as User;

describe('OrderPlacementService', () => {
  let service: OrderPlacementService;
  let exchangeSelectionService: jest.Mocked<ExchangeSelectionService>;
  let tradeCooldownService: jest.Mocked<TradeCooldownService>;
  let orderService: jest.Mocked<OrderService>;
  let tradeExecutionService: jest.Mocked<TradeExecutionService>;
  let positionTracking: jest.Mocked<PositionTrackingService>;
  let metricsService: jest.Mocked<MetricsService>;

  beforeEach(async () => {
    exchangeSelectionService = {
      selectForBuy: jest.fn().mockResolvedValue({ id: 'ek-1', name: 'Binance US' }),
      selectForSell: jest.fn().mockResolvedValue({ id: 'ek-1', name: 'Binance US' })
    } as unknown as jest.Mocked<ExchangeSelectionService>;

    tradeCooldownService = {
      checkAndClaim: jest.fn().mockResolvedValue({ allowed: true }),
      clearCooldown: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<TradeCooldownService>;

    orderService = {
      placeAlgorithmicOrder: jest.fn().mockResolvedValue({ id: 'order-1' })
    } as unknown as jest.Mocked<OrderService>;

    tradeExecutionService = {
      executeTradeSignal: jest.fn().mockResolvedValue({ id: 'order-1' })
    } as unknown as jest.Mocked<TradeExecutionService>;

    positionTracking = {
      updatePosition: jest.fn()
    } as unknown as jest.Mocked<PositionTrackingService>;

    metricsService = {
      recordTradeCooldownBlock: jest.fn(),
      recordTradeCooldownClaim: jest.fn(),
      recordTradeCooldownCleared: jest.fn(),
      recordLiveOrderPlaced: jest.fn()
    } as unknown as jest.Mocked<MetricsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderPlacementService,
        { provide: ExchangeSelectionService, useValue: exchangeSelectionService },
        { provide: TradeCooldownService, useValue: tradeCooldownService },
        { provide: OrderService, useValue: orderService },
        { provide: TradeExecutionService, useValue: tradeExecutionService },
        { provide: PositionTrackingService, useValue: positionTracking },
        { provide: MetricsService, useValue: metricsService }
      ]
    }).compile();

    service = module.get(OrderPlacementService);
  });

  const user = createUser();
  const buySignal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
  const sellSignal: TradingSignal = { action: 'sell', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
  const spotStrategy = { id: 'strategy-1' } as any;
  const futuresStrategy = { id: 'strategy-1', marketType: 'futures', defaultLeverage: 1 } as any;

  describe('spot order placement', () => {
    it('places spot buy order and tracks as buy/long', async () => {
      const result = await service.placeOrder(user, 'strategy-1', buySignal, spotStrategy);

      expect(result).toEqual(expect.objectContaining({ status: 'placed', orderId: 'order-1' }));
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 },
        'ek-1'
      );
      expect(positionTracking.updatePosition).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        'BTC/USDT',
        0.01,
        30000,
        'buy',
        'long',
        'ek-1'
      );
    });

    it('places spot sell order and tracks as sell/long', async () => {
      const result = await service.placeOrder(user, 'strategy-1', sellSignal, spotStrategy);

      expect(result).toEqual(expect.objectContaining({ status: 'placed', orderId: 'order-1' }));
      expect(positionTracking.updatePosition).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        'BTC/USDT',
        0.01,
        30000,
        'sell',
        'long',
        undefined
      );
    });
  });

  describe('futures order placement', () => {
    it('routes short_entry through futures path as SELL/short', async () => {
      const signal: TradingSignal = { action: 'short_entry', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;

      const result = await service.placeOrder(user, 'strategy-1', signal, futuresStrategy);

      expect(result).toEqual(expect.objectContaining({ status: 'placed' }));
      expect(tradeExecutionService.executeTradeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SELL',
          symbol: 'BTC/USDT',
          quantity: 0.01,
          marketType: 'futures',
          positionSide: 'short',
          leverage: 1
        })
      );
      expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
      // short_entry opens a position → exchangeKeyId must be persisted
      expect(positionTracking.updatePosition).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        'BTC/USDT',
        0.01,
        30000,
        'buy',
        'short',
        'ek-1'
      );
    });

    it('routes short_exit through futures path as BUY/short', async () => {
      const signal: TradingSignal = { action: 'short_exit', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;

      const result = await service.placeOrder(user, 'strategy-1', signal, futuresStrategy);

      expect(result).toEqual(expect.objectContaining({ status: 'placed' }));
      expect(tradeExecutionService.executeTradeSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BUY',
          symbol: 'BTC/USDT',
          quantity: 0.01,
          marketType: 'futures',
          positionSide: 'short',
          leverage: 1
        })
      );
      // short_exit closes a position → no exchangeKeyId needed
      expect(positionTracking.updatePosition).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        'BTC/USDT',
        0.01,
        30000,
        'sell',
        'short',
        undefined
      );
    });
  });

  describe('exchange selection', () => {
    it('returns blocked when no exchange key found for buy', async () => {
      exchangeSelectionService.selectForBuy.mockRejectedValue(new Error('No suitable exchange key'));

      const result = await service.placeOrder(user, 'strategy-1', buySignal, spotStrategy);

      expect(result.status).toBe('blocked');
      expect(result).toEqual(expect.objectContaining({ reasonCode: SignalReasonCode.EXCHANGE_SELECTION_FAILED }));
      expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    });

    it('uses selectForSell for sell actions', async () => {
      await service.placeOrder(user, 'strategy-1', sellSignal, spotStrategy);

      expect(exchangeSelectionService.selectForSell).toHaveBeenCalledWith('user-1', 'BTC/USDT', 'strategy-1');
      expect(exchangeSelectionService.selectForBuy).not.toHaveBeenCalled();
    });
  });

  describe('trade cooldown', () => {
    it('returns blocked when cooldown rejects', async () => {
      tradeCooldownService.checkAndClaim.mockResolvedValue({
        allowed: false,
        existingClaim: { pipeline: 'pipeline:abc' }
      } as any);

      const result = await service.placeOrder(user, 'strategy-1', buySignal, spotStrategy);

      expect(result.status).toBe('blocked');
      expect(result).toEqual(expect.objectContaining({ reasonCode: SignalReasonCode.TRADE_COOLDOWN }));
      expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    });

    it('clears cooldown when order placement fails', async () => {
      orderService.placeAlgorithmicOrder.mockRejectedValue(new Error('Exchange error'));

      const result = await service.placeOrder(user, 'strategy-1', buySignal, spotStrategy);

      expect(result.status).toBe('failed');
      expect(tradeCooldownService.clearCooldown).toHaveBeenCalledWith('user-1', 'BTC/USDT', 'BUY');
    });
  });

  describe('mapSignalActionToDirection', () => {
    it.each([
      ['buy', 'BUY'],
      ['short_exit', 'BUY'],
      ['sell', 'SELL'],
      ['short_entry', 'SELL']
    ])('maps %s to %s', (action, expected) => {
      expect(service.mapSignalActionToDirection(action)).toBe(expected);
    });
  });

  describe('mapSignalToPositionTracking', () => {
    it.each([
      ['buy', { side: 'buy', positionSide: 'long' }],
      ['sell', { side: 'sell', positionSide: 'long' }],
      ['short_entry', { side: 'buy', positionSide: 'short' }],
      ['short_exit', { side: 'sell', positionSide: 'short' }]
    ])('maps %s correctly', (action, expected) => {
      expect(service.mapSignalToPositionTracking(action)).toEqual(expected);
    });

    it('throws on unknown action', () => {
      expect(() => service.mapSignalToPositionTracking('unknown')).toThrow('Unknown signal action');
    });
  });
});
