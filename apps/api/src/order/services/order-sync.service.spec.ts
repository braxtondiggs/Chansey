import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import type * as ccxt from 'ccxt';

import { OrderCalculationService } from './order-calculation.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderSyncService } from './order-sync.service';
import { PositionManagementService } from './position-management.service';

import { CoinService } from '../../coin/coin.service';
import { TickerPairService } from '../../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { MetricsService } from '../../metrics/metrics.service';
import { Order } from '../order.entity';

// Mock retry utilities to pass through directly
jest.mock('../../shared/retry.util', () => ({
  withRateLimitRetry: jest.fn(async (fn: () => Promise<any>) => {
    try {
      const result = await fn();
      return { success: true, result };
    } catch (error) {
      return { success: false, error };
    }
  }),
  withRateLimitRetryThrow: jest.fn(async (fn: () => Promise<any>) => fn())
}));

describe('OrderSyncService', () => {
  let service: OrderSyncService;

  const mockOrderRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn()
  };

  const createMockClient = (
    markets: Record<string, { active?: boolean }>,
    overrides: Partial<Record<string, jest.Mock>> = {}
  ) =>
    ({
      id: 'binance_us',
      has: { fetchOrders: true, fetchMyTrades: true },
      loadMarkets: jest.fn().mockResolvedValue(markets),
      fetchOrders: jest.fn().mockResolvedValue([]),
      fetchMyTrades: jest.fn().mockResolvedValue([]),
      ...overrides
    }) as unknown as ccxt.Exchange;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderSyncService,
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: OrderCalculationService, useValue: {} },
        { provide: CoinService, useValue: {} },
        { provide: ExchangeService, useValue: {} },
        { provide: TickerPairService, useValue: {} },
        { provide: ExchangeKeyService, useValue: {} },
        { provide: ExchangeManagerService, useValue: {} },
        { provide: MetricsService, useValue: {} },
        { provide: OrderStateMachineService, useValue: {} },
        { provide: PositionManagementService, useValue: {} }
      ]
    }).compile();

    service = module.get<OrderSyncService>(OrderSyncService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('fetchFromExchange (via fetchHistoricalOrders)', () => {
    it('should only fetch from active markets, skipping delisted ones', async () => {
      const client = createMockClient({
        'BTC/USD': { active: true },
        'RLC/USD': { active: false },
        'ETH/USD': { active: true },
        'VOXEL/USD': { active: false }
      });

      await service.fetchHistoricalOrders(client);

      expect(client.fetchOrders).toHaveBeenCalledTimes(2);
      expect(client.fetchOrders).toHaveBeenCalledWith('BTC/USD', undefined);
      expect(client.fetchOrders).toHaveBeenCalledWith('ETH/USD', undefined);
      expect(client.fetchOrders).not.toHaveBeenCalledWith('RLC/USD', expect.anything());
      expect(client.fetchOrders).not.toHaveBeenCalledWith('VOXEL/USD', expect.anything());
    });

    it('should treat markets with active === undefined as active (safe fallback)', async () => {
      const client = createMockClient({
        'BTC/USD': { active: true },
        'SOL/USD': { active: undefined },
        'DOGE/USD': {}
      });

      await service.fetchHistoricalOrders(client);

      expect(client.fetchOrders).toHaveBeenCalledTimes(3);
      expect(client.fetchOrders).toHaveBeenCalledWith('SOL/USD', undefined);
      expect(client.fetchOrders).toHaveBeenCalledWith('DOGE/USD', undefined);
    });

    it('should not call fetchFn when all markets are inactive', async () => {
      const client = createMockClient({
        'RLC/USD': { active: false },
        'VOXEL/USD': { active: false }
      });

      const result = await service.fetchHistoricalOrders(client);

      expect(client.fetchOrders).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should return empty array when exchange does not support capability', async () => {
      const client = { id: 'test', has: { fetchOrders: false } } as unknown as ccxt.Exchange;

      const result = await service.fetchHistoricalOrders(client);

      expect(result).toEqual([]);
    });

    it('should return empty array and not throw when loadMarkets fails', async () => {
      const client = createMockClient(
        {},
        { loadMarkets: jest.fn().mockRejectedValue(new Error('Exchange unavailable')) }
      );

      const result = await service.fetchHistoricalOrders(client);

      expect(result).toEqual([]);
      expect(client.fetchOrders).not.toHaveBeenCalled();
    });

    it('should continue fetching remaining symbols when one fails', async () => {
      const mockOrder = { id: '1', symbol: 'ETH/USD' } as ccxt.Order;
      const client = createMockClient({
        'BTC/USD': { active: true },
        'ETH/USD': { active: true }
      });
      (client.fetchOrders as jest.Mock)
        .mockRejectedValueOnce(new Error('Rate limited'))
        .mockResolvedValueOnce([mockOrder]);

      const result = await service.fetchHistoricalOrders(client);

      expect(client.fetchOrders).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should deduplicate results by order id across symbols', async () => {
      const mockOrder = { id: '123', symbol: 'BTC/USD' } as ccxt.Order;
      const client = createMockClient({
        'BTC/USD': { active: true },
        'ETH/USD': { active: true }
      });
      (client.fetchOrders as jest.Mock).mockResolvedValueOnce([mockOrder]).mockResolvedValueOnce([mockOrder]);

      const result = await service.fetchHistoricalOrders(client);

      expect(result).toHaveLength(1);
    });

    it('should pass lastSyncTime as unix timestamp to fetchFn', async () => {
      const syncTime = new Date('2025-06-01T00:00:00Z');
      const client = createMockClient({ 'BTC/USD': { active: true } });

      await service.fetchHistoricalOrders(client, syncTime);

      expect(client.fetchOrders).toHaveBeenCalledWith('BTC/USD', syncTime.getTime());
    });
  });

  describe('fetchMyTrades', () => {
    it('should filter inactive markets the same as fetchHistoricalOrders', async () => {
      const client = createMockClient({
        'BTC/USD': { active: true },
        'DELISTED/USD': { active: false }
      });

      await service.fetchMyTrades(client);

      expect(client.fetchMyTrades).toHaveBeenCalledTimes(1);
      expect(client.fetchMyTrades).toHaveBeenCalledWith('BTC/USD', undefined);
    });
  });
});
