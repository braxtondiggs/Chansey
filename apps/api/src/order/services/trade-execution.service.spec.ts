import { BadRequestException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OrderStateMachineService } from './order-state-machine.service';
import { TradeExecutionService } from './trade-execution.service';

import { CoinService } from '../../coin/coin.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { User } from '../../users/users.entity';
import { slippageLimitsConfig } from '../config/slippage-limits.config';
import { Order } from '../order.entity';

describe('TradeExecutionService', () => {
  let service: TradeExecutionService;
  let mockOrderRepository: any;
  let mockExchangeKeyService: any;
  let mockExchangeManagerService: any;
  let mockCoinService: any;
  let mockUserRepository: any;
  let mockStateMachineService: any;
  let loggerWarnSpy: jest.SpyInstance;

  describe('constructor validation', () => {
    it('should throw when maxSlippageBps is less than warnSlippageBps', async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            TradeExecutionService,
            { provide: getRepositoryToken(Order), useValue: {} },
            { provide: getRepositoryToken(User), useValue: {} },
            { provide: ExchangeKeyService, useValue: {} },
            { provide: ExchangeManagerService, useValue: {} },
            { provide: CoinService, useValue: {} },
            { provide: OrderStateMachineService, useValue: {} },
            {
              provide: slippageLimitsConfig.KEY,
              useValue: {
                maxSlippageBps: 50,
                warnSlippageBps: 100,
                abortOnHighSlippage: false,
                enabled: true
              }
            }
          ]
        }).compile()
      ).rejects.toThrow('MAX_SLIPPAGE_BPS (50) must be greater than WARN_SLIPPAGE_BPS (100)');
    });

    it('should throw when maxSlippageBps equals warnSlippageBps', async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            TradeExecutionService,
            { provide: getRepositoryToken(Order), useValue: {} },
            { provide: getRepositoryToken(User), useValue: {} },
            { provide: ExchangeKeyService, useValue: {} },
            { provide: ExchangeManagerService, useValue: {} },
            { provide: CoinService, useValue: {} },
            { provide: OrderStateMachineService, useValue: {} },
            {
              provide: slippageLimitsConfig.KEY,
              useValue: {
                maxSlippageBps: 100,
                warnSlippageBps: 100,
                abortOnHighSlippage: false,
                enabled: true
              }
            }
          ]
        }).compile()
      ).rejects.toThrow('MAX_SLIPPAGE_BPS (100) must be greater than WARN_SLIPPAGE_BPS (100)');
    });
  });

  beforeEach(async () => {
    mockOrderRepository = {
      save: jest.fn()
    };

    mockUserRepository = {
      findOneBy: jest.fn()
    };

    mockExchangeKeyService = {
      findOne: jest.fn()
    };

    mockExchangeManagerService = {
      getExchangeClient: jest.fn()
    };

    mockCoinService = {
      getCoinBySymbol: jest.fn()
    };

    mockStateMachineService = {
      transitionStatus: jest.fn().mockResolvedValue({
        valid: true,
        fromStatus: null,
        toStatus: 'FILLED',
        reason: 'trade_execution'
      }),
      getOrderHistory: jest.fn().mockResolvedValue([]),
      isValidTransition: jest.fn().mockReturnValue(true),
      isTerminalState: jest.fn().mockReturnValue(false)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeExecutionService,
        {
          provide: getRepositoryToken(Order),
          useValue: mockOrderRepository
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository
        },
        {
          provide: ExchangeKeyService,
          useValue: mockExchangeKeyService
        },
        {
          provide: ExchangeManagerService,
          useValue: mockExchangeManagerService
        },
        {
          provide: CoinService,
          useValue: mockCoinService
        },
        {
          provide: OrderStateMachineService,
          useValue: mockStateMachineService
        },
        {
          provide: slippageLimitsConfig.KEY,
          useValue: {
            maxSlippageBps: 100,
            warnSlippageBps: 50,
            abortOnHighSlippage: false,
            enabled: true
          }
        }
      ]
    }).compile();

    service = module.get<TradeExecutionService>(TradeExecutionService);

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeTradeSignal', () => {
    const baseSignal = {
      algorithmActivationId: 'activation-id',
      userId: 'user-id',
      exchangeKeyId: 'exchange-key-id',
      action: 'BUY' as const,
      symbol: 'BTC/USDT',
      quantity: 1
    };

    const mockUser = { id: 'user-id' };
    const mockExchange = { slug: 'binance', name: 'Binance' };

    const buildExchangeClient = (overrides: Partial<any> = {}) => ({
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTicker: jest.fn().mockResolvedValue({ ask: 100, bid: 99, last: 98 }),
      fetchOrderBook: jest.fn().mockResolvedValue({ asks: [[100, 1]], bids: [[99, 1]] }),
      createMarketOrder: jest.fn().mockResolvedValue({
        id: 'ccxt-order-id',
        clientOrderId: 'client-order-id',
        symbol: 'BTC/USDT',
        timestamp: Date.now(),
        amount: 1,
        filled: 1,
        average: 101,
        price: 101,
        cost: 101,
        fee: { cost: 0.1, currency: 'USDT' },
        status: 'closed',
        side: 'buy',
        type: 'market',
        trades: [],
        info: {}
      }),
      markets: { 'BTC/USDT': {} },
      ...overrides
    });

    beforeEach(() => {
      mockOrderRepository.save.mockImplementation(async (order: any) => order);
      mockExchangeKeyService.findOne.mockResolvedValue({ exchange: mockExchange });
      mockUserRepository.findOneBy.mockResolvedValue(mockUser);
      mockCoinService.getCoinBySymbol.mockResolvedValue({ symbol: 'BTC' });
    });

    it('should throw when exchange key is missing', async () => {
      mockExchangeKeyService.findOne.mockResolvedValue(null);

      await expect(service.executeTradeSignal(baseSignal)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockExchangeManagerService.getExchangeClient).not.toHaveBeenCalled();
    });

    it('should throw when user is missing', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(service.executeTradeSignal(baseSignal)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockExchangeManagerService.getExchangeClient).not.toHaveBeenCalled();
    });

    it('should throw when symbol is not available on the exchange', async () => {
      const mockExchangeClient = buildExchangeClient({ markets: {} });
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);

      await expect(service.executeTradeSignal(baseSignal)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockExchangeClient.createMarketOrder).not.toHaveBeenCalled();
    });

    it('should reject when estimated slippage exceeds max threshold', async () => {
      const mockExchangeClient = buildExchangeClient();
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);

      jest.spyOn(service as any, 'estimateSlippageFromOrderBook').mockResolvedValue(200);

      await expect(service.executeTradeSignal(baseSignal)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockExchangeClient.createMarketOrder).not.toHaveBeenCalled();
    });

    it('should execute a market order and persist slippage details', async () => {
      const mockExchangeClient = buildExchangeClient();
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);

      jest.spyOn(service as any, 'estimateSlippageFromOrderBook').mockResolvedValue(10);

      const result = await service.executeTradeSignal(baseSignal);

      expect(mockExchangeClient.loadMarkets).toHaveBeenCalled();
      expect(mockExchangeClient.createMarketOrder).toHaveBeenCalledWith('BTC/USDT', 'buy', 1);
      expect(mockOrderRepository.save).toHaveBeenCalled();
      expect(result.symbol).toBe('BTC/USDT');
      expect(result.expectedPrice).toBe(100);
      expect(result.actualSlippageBps).toBe(100);
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('High slippage detected'));
    });

    it('should use bid price when executing a SELL signal', async () => {
      const mockExchangeClient = buildExchangeClient({
        fetchTicker: jest.fn().mockResolvedValue({ ask: 100, bid: 95, last: 96 }),
        createMarketOrder: jest.fn().mockResolvedValue({
          id: 'ccxt-order-id',
          clientOrderId: 'client-order-id',
          symbol: 'BTC/USDT',
          timestamp: Date.now(),
          amount: 1,
          filled: 1,
          average: 94.05,
          price: 94.05,
          cost: 94.05,
          fee: { cost: 0.1, currency: 'USDT' },
          status: 'closed',
          side: 'sell',
          type: 'market',
          trades: [],
          info: {}
        })
      });
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);

      jest.spyOn(service as any, 'estimateSlippageFromOrderBook').mockResolvedValue(10);

      const result = await service.executeTradeSignal({ ...baseSignal, action: 'SELL' });

      expect(mockExchangeClient.createMarketOrder).toHaveBeenCalledWith('BTC/USDT', 'sell', 1);
      expect(result.expectedPrice).toBe(95);
      expect(result.actualSlippageBps).toBe(100);
    });
  });

  describe('estimateSlippageFromOrderBook', () => {
    // Access private method for testing
    const getEstimateSlippageMethod = (svc: TradeExecutionService) => {
      return (svc as any).estimateSlippageFromOrderBook.bind(svc);
    };

    it('should return 0 for empty order book', async () => {
      const mockExchangeClient = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [],
          bids: []
        })
      };

      const estimateSlippage = getEstimateSlippageMethod(service);
      const result = await estimateSlippage(mockExchangeClient, 'BTC/USDT', 1, 'BUY', 50000);

      expect(result).toBe(0);
    });

    it('should calculate slippage for BUY order using asks', async () => {
      const mockExchangeClient = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [
            [50000, 0.5], // price, volume
            [50100, 0.5],
            [50200, 1.0]
          ],
          bids: [
            [49900, 1.0],
            [49800, 1.0]
          ]
        })
      };

      const estimateSlippage = getEstimateSlippageMethod(service);
      // Order 1 BTC, expected price 50000
      // Fills: 0.5 @ 50000 + 0.5 @ 50100 = 25000 + 25050 = 50050
      // VWAP = 50050, slippage = (50050 - 50000) / 50000 * 10000 = 10 bps
      const result = await estimateSlippage(mockExchangeClient, 'BTC/USDT', 1, 'BUY', 50000);

      expect(result).toBeCloseTo(10, 0);
    });

    it('should calculate slippage for SELL order using bids', async () => {
      const mockExchangeClient = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [[50100, 1.0]],
          bids: [
            [50000, 0.5], // price, volume
            [49900, 0.5],
            [49800, 1.0]
          ]
        })
      };

      const estimateSlippage = getEstimateSlippageMethod(service);
      // Order 1 BTC, expected price 50000
      // Fills: 0.5 @ 50000 + 0.5 @ 49900 = 25000 + 24950 = 49950
      // VWAP = 49950, slippage = (50000 - 49950) / 50000 * 10000 = 10 bps
      const result = await estimateSlippage(mockExchangeClient, 'BTC/USDT', 1, 'SELL', 50000);

      expect(result).toBeCloseTo(10, 0);
    });

    it('should handle insufficient liquidity with worst-case estimate for BUY', async () => {
      const mockExchangeClient = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [
            [50000, 0.5], // Only 0.5 available
            [50100, 0.3] // Only 0.3 more
          ],
          bids: []
        })
      };

      const estimateSlippage = getEstimateSlippageMethod(service);
      // Order 1 BTC but only 0.8 available
      // Fills: 0.5 @ 50000 + 0.3 @ 50100 = 25000 + 15030 = 40030
      // Remaining 0.2 @ worst case (50100 * 1.01 = 50601)
      // Total: 40030 + 0.2 * 50601 = 40030 + 10120.2 = 50150.2
      // VWAP = 50150.2, slippage = 30.04 bps
      const result = await estimateSlippage(mockExchangeClient, 'BTC/USDT', 1, 'BUY', 50000);

      expect(result).toBeCloseTo(30.04, 2);
    });

    it('should handle insufficient liquidity with worst-case estimate for SELL', async () => {
      const mockExchangeClient = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [],
          bids: [
            [50000, 0.5], // Only 0.5 available
            [49900, 0.3] // Only 0.3 more
          ]
        })
      };

      const estimateSlippage = getEstimateSlippageMethod(service);
      // Remaining quantity will get worst-case price (49900 * 0.99)
      const result = await estimateSlippage(mockExchangeClient, 'BTC/USDT', 1, 'SELL', 50000);

      expect(result).toBeCloseTo(29.96, 2);
    });

    it('should return 0 when fetchOrderBook throws an error', async () => {
      const mockExchangeClient = {
        fetchOrderBook: jest.fn().mockRejectedValue(new Error('Exchange API error'))
      };

      const estimateSlippage = getEstimateSlippageMethod(service);
      const result = await estimateSlippage(mockExchangeClient, 'BTC/USDT', 1, 'BUY', 50000);

      expect(result).toBe(0);
    });

    it('should handle exact fill with no slippage', async () => {
      const mockExchangeClient = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [
            [50000, 1.0] // Exact amount at expected price
          ],
          bids: []
        })
      };

      const estimateSlippage = getEstimateSlippageMethod(service);
      const result = await estimateSlippage(mockExchangeClient, 'BTC/USDT', 1, 'BUY', 50000);

      expect(result).toBe(0);
    });

    it('should return absolute value of slippage (always positive)', async () => {
      const mockExchangeClient = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [
            [49900, 1.0] // Better price than expected (favorable slippage)
          ],
          bids: []
        })
      };

      const estimateSlippage = getEstimateSlippageMethod(service);
      const result = await estimateSlippage(mockExchangeClient, 'BTC/USDT', 1, 'BUY', 50000);

      // Even if calculated slippage is negative (favorable), return absolute value
      expect(result).toBe(20);
    });

    it('should handle null order book sides gracefully', async () => {
      const mockExchangeClient = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: null,
          bids: null
        })
      };

      const estimateSlippage = getEstimateSlippageMethod(service);
      const result = await estimateSlippage(mockExchangeClient, 'BTC/USDT', 1, 'BUY', 50000);

      expect(result).toBe(0);
    });

    it('should calculate VWAP correctly across multiple price levels', async () => {
      const mockExchangeClient = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [
            [100, 10], // 10 units @ 100
            [110, 10], // 10 units @ 110
            [120, 10], // 10 units @ 120
            [130, 10] // 10 units @ 130
          ],
          bids: []
        })
      };

      const estimateSlippage = getEstimateSlippageMethod(service);
      // Order 25 units, expected price 100
      // Fills: 10 @ 100 + 10 @ 110 + 5 @ 120 = 1000 + 1100 + 600 = 2700
      // VWAP = 2700 / 25 = 108
      // Slippage = (108 - 100) / 100 * 10000 = 800 bps
      const result = await estimateSlippage(mockExchangeClient, 'TEST/USD', 25, 'BUY', 100);

      expect(result).toBeCloseTo(800, 0);
    });
  });

  describe('calculateSlippageBps', () => {
    // Access private method for testing
    const getCalculateSlippageBps = (svc: TradeExecutionService) => {
      return (svc as any).calculateSlippageBps.bind(svc);
    };

    it('should return 0 for equal prices', () => {
      const calculateSlippageBps = getCalculateSlippageBps(service);
      const result = calculateSlippageBps(100, 100, 'BUY');

      expect(result).toBe(0);
    });

    it('should calculate positive slippage for unfavorable BUY (actual > expected)', () => {
      const calculateSlippageBps = getCalculateSlippageBps(service);
      // Paid 101 when expected 100 = unfavorable
      const result = calculateSlippageBps(100, 101, 'BUY');

      expect(result).toBe(100); // 1% = 100 bps
    });

    it('should calculate negative slippage for favorable BUY (actual < expected)', () => {
      const calculateSlippageBps = getCalculateSlippageBps(service);
      // Paid 99 when expected 100 = favorable
      const result = calculateSlippageBps(100, 99, 'BUY');

      expect(result).toBe(-100); // -1% = -100 bps
    });

    it('should calculate positive slippage for unfavorable SELL (actual < expected)', () => {
      const calculateSlippageBps = getCalculateSlippageBps(service);
      // Received 99 when expected 100 = unfavorable
      const result = calculateSlippageBps(100, 99, 'SELL');

      expect(result).toBe(100); // 1% = 100 bps
    });

    it('should calculate negative slippage for favorable SELL (actual > expected)', () => {
      const calculateSlippageBps = getCalculateSlippageBps(service);
      // Received 101 when expected 100 = favorable
      const result = calculateSlippageBps(100, 101, 'SELL');

      expect(result).toBe(-100); // -1% = -100 bps
    });

    it('should return 0 for zero expected price', () => {
      const calculateSlippageBps = getCalculateSlippageBps(service);
      const result = calculateSlippageBps(0, 100, 'BUY');

      expect(result).toBe(0);
    });

    it('should return 0 for zero actual price', () => {
      const calculateSlippageBps = getCalculateSlippageBps(service);
      const result = calculateSlippageBps(100, 0, 'BUY');

      expect(result).toBe(0);
    });

    it('should handle fractional basis points', () => {
      const calculateSlippageBps = getCalculateSlippageBps(service);
      // 0.05% slippage = 5 bps
      const result = calculateSlippageBps(10000, 10005, 'BUY');

      expect(result).toBe(5);
    });
  });

  describe('calculateTradeSize', () => {
    it('should calculate trade size based on allocation percentage', () => {
      const mockActivation = {
        allocationPercentage: 10 // 10%
      };

      const result = service.calculateTradeSize(mockActivation as any, 100000);

      expect(result).toBe(10000); // 10% of $100,000
    });

    it('should default to 1% when allocationPercentage is not set', () => {
      const mockActivation = {};

      const result = service.calculateTradeSize(mockActivation as any, 100000);

      expect(result).toBe(1000); // 1% of $100,000
    });

    it('should handle zero portfolio value', () => {
      const mockActivation = {
        allocationPercentage: 10
      };

      const result = service.calculateTradeSize(mockActivation as any, 0);

      expect(result).toBe(0);
    });

    it('should handle 100% allocation', () => {
      const mockActivation = {
        allocationPercentage: 100
      };

      const result = service.calculateTradeSize(mockActivation as any, 50000);

      expect(result).toBe(50000);
    });
  });
});
