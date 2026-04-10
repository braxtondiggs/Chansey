import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MarketType } from '@chansey/api-interfaces';

import { OrderConversionService } from './order-conversion.service';
import { OrderValidationService } from './order-validation.service';
import { PositionManagementService } from './position-management.service';
import { TradeExecutionService } from './trade-execution.service';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { ValidationException } from '../../common/exceptions/base';
import { InvalidSymbolException, SlippageExceededException } from '../../common/exceptions/order';
import { ExchangeKeyNotFoundException, UserNotFoundException } from '../../common/exceptions/resource';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { NOTIFICATION_EVENTS } from '../../notification/interfaces/notification-events.interface';
import { User } from '../../users/users.entity';
import { slippageLimitsConfig } from '../config/slippage-limits.config';

describe('TradeExecutionService', () => {
  let service: TradeExecutionService;
  let mockExchangeKeyService: any;
  let mockExchangeManagerService: any;
  let mockOrderConversionService: any;
  let mockOrderValidationService: any;
  let mockUserRepository: any;
  let mockEventEmitter: any;
  let mockPositionManagementService: any;
  let loggerWarnSpy: jest.SpyInstance;

  const buildConstructorProviders = (slippageConfig: any) => [
    TradeExecutionService,
    { provide: getRepositoryToken(User), useValue: {} },
    { provide: getRepositoryToken(AlgorithmActivation), useValue: {} },
    { provide: ExchangeKeyService, useValue: {} },
    { provide: ExchangeManagerService, useValue: {} },
    { provide: OrderConversionService, useValue: {} },
    { provide: OrderValidationService, useValue: { validateAlgorithmicOrderSize: jest.fn() } },
    { provide: EventEmitter2, useValue: { emit: jest.fn() } },
    { provide: slippageLimitsConfig.KEY, useValue: slippageConfig }
  ];

  describe('constructor validation', () => {
    it('should throw when maxSlippageBps is less than warnSlippageBps', async () => {
      await expect(
        Test.createTestingModule({
          providers: buildConstructorProviders({
            maxSlippageBps: 50,
            warnSlippageBps: 100,
            abortOnHighSlippage: false,
            enabled: true
          })
        }).compile()
      ).rejects.toThrow('MAX_SLIPPAGE_BPS (50) must be greater than WARN_SLIPPAGE_BPS (100)');
    });

    it('should throw when maxSlippageBps equals warnSlippageBps', async () => {
      await expect(
        Test.createTestingModule({
          providers: buildConstructorProviders({
            maxSlippageBps: 100,
            warnSlippageBps: 100,
            abortOnHighSlippage: false,
            enabled: true
          })
        }).compile()
      ).rejects.toThrow('MAX_SLIPPAGE_BPS (100) must be greater than WARN_SLIPPAGE_BPS (100)');
    });
  });

  const mockUser = { id: 'user-id', futuresEnabled: true };
  const mockExchange = { slug: 'binance', name: 'Binance' };

  const baseSignal = {
    algorithmActivationId: 'activation-id',
    userId: 'user-id',
    exchangeKeyId: 'exchange-key-id',
    action: 'BUY' as const,
    symbol: 'BTC/USDT',
    quantity: 1
  };

  const buildCcxtOrder = (overrides: Partial<any> = {}) => ({
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
    info: {},
    ...overrides
  });

  const buildExchangeClient = (overrides: Partial<any> = {}) => ({
    loadMarkets: jest.fn().mockResolvedValue(undefined),
    fetchTicker: jest.fn().mockResolvedValue({ ask: 100, bid: 99, last: 98 }),
    fetchOrderBook: jest.fn().mockResolvedValue({ asks: [[100, 10]], bids: [[99, 10]] }),
    createMarketOrder: jest.fn().mockResolvedValue(buildCcxtOrder()),
    markets: { 'BTC/USDT': {} },
    ...overrides
  });

  beforeEach(async () => {
    mockUserRepository = { findOneBy: jest.fn() };
    mockExchangeKeyService = { findOne: jest.fn() };
    mockEventEmitter = { emit: jest.fn() };
    mockOrderValidationService = { validateAlgorithmicOrderSize: jest.fn() };
    mockPositionManagementService = {
      attachExitOrders: jest.fn().mockResolvedValue({
        stopLossOrderId: 'sl-id',
        takeProfitOrderId: 'tp-id',
        ocoLinked: true,
        warnings: []
      })
    };

    mockExchangeManagerService = {
      getExchangeClient: jest.fn(),
      getExchangeService: jest.fn()
    };

    mockOrderConversionService = {
      convertCcxtOrderToEntity: jest
        .fn()
        .mockImplementation(
          (
            ccxtOrder: any,
            _user: any,
            _exchange: any,
            _activationId: string,
            expectedPrice?: number,
            actualSlippageBps?: number
          ) => ({
            id: 'order-id',
            symbol: ccxtOrder.symbol,
            expectedPrice,
            actualSlippageBps,
            executedQuantity: ccxtOrder.filled,
            price: ccxtOrder.price || ccxtOrder.average,
            status: 'FILLED'
          })
        )
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeExecutionService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: getRepositoryToken(AlgorithmActivation), useValue: {} },
        { provide: ExchangeKeyService, useValue: mockExchangeKeyService },
        { provide: ExchangeManagerService, useValue: mockExchangeManagerService },
        { provide: OrderConversionService, useValue: mockOrderConversionService },
        { provide: OrderValidationService, useValue: mockOrderValidationService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: PositionManagementService, useValue: mockPositionManagementService },
        {
          provide: slippageLimitsConfig.KEY,
          useValue: { maxSlippageBps: 100, warnSlippageBps: 50, abortOnHighSlippage: false, enabled: true }
        }
      ]
    }).compile();

    service = module.get<TradeExecutionService>(TradeExecutionService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /** Helper: set up default mocks for a successful executeTradeSignal call */
  const setupHappyPath = (clientOverrides: Partial<any> = {}) => {
    const mockExchangeClient = buildExchangeClient(clientOverrides);
    mockExchangeKeyService.findOne.mockResolvedValue({ exchange: mockExchange });
    mockUserRepository.findOneBy.mockResolvedValue(mockUser);
    mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);
    jest.spyOn(service as any, 'estimateSlippageFromOrderBook').mockResolvedValue(0);
    return mockExchangeClient;
  };

  describe('executeTradeSignal', () => {
    beforeEach(() => {
      mockExchangeKeyService.findOne.mockResolvedValue({ exchange: mockExchange });
      mockUserRepository.findOneBy.mockResolvedValue(mockUser);
    });

    // --- Prerequisite validation ---

    it('should throw ExchangeKeyNotFoundException when exchange key is missing', async () => {
      mockExchangeKeyService.findOne.mockResolvedValue(null);

      await expect(service.executeTradeSignal(baseSignal)).rejects.toBeInstanceOf(ExchangeKeyNotFoundException);
      expect(mockExchangeManagerService.getExchangeClient).not.toHaveBeenCalled();
    });

    it('should throw UserNotFoundException when user does not exist', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(service.executeTradeSignal(baseSignal)).rejects.toBeInstanceOf(UserNotFoundException);
      expect(mockExchangeManagerService.getExchangeClient).not.toHaveBeenCalled();
    });

    it('should throw ValidationException for futures signal when user has futures disabled', async () => {
      mockUserRepository.findOneBy.mockResolvedValue({ id: 'user-id', futuresEnabled: false });
      const signal = { ...baseSignal, marketType: MarketType.FUTURES as const };

      await expect(service.executeTradeSignal(signal)).rejects.toBeInstanceOf(ValidationException);
    });

    it('should throw InvalidSymbolException when symbol is not on the exchange', async () => {
      const mockExchangeClient = buildExchangeClient({ markets: {} });
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);

      await expect(service.executeTradeSignal(baseSignal)).rejects.toBeInstanceOf(InvalidSymbolException);
      expect(mockExchangeClient.createMarketOrder).not.toHaveBeenCalled();
    });

    // --- Slippage ---

    it('should reject when estimated slippage exceeds max threshold', async () => {
      const mockExchangeClient = buildExchangeClient();
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);
      jest.spyOn(service as any, 'estimateSlippageFromOrderBook').mockResolvedValue(200);

      await expect(service.executeTradeSignal(baseSignal)).rejects.toBeInstanceOf(SlippageExceededException);
      expect(mockExchangeClient.createMarketOrder).not.toHaveBeenCalled();
    });

    it('should skip slippage check when slippage limits are disabled', async () => {
      const disabledModule = await Test.createTestingModule({
        providers: [
          TradeExecutionService,
          { provide: getRepositoryToken(User), useValue: mockUserRepository },
          { provide: getRepositoryToken(AlgorithmActivation), useValue: {} },
          { provide: ExchangeKeyService, useValue: mockExchangeKeyService },
          { provide: ExchangeManagerService, useValue: mockExchangeManagerService },
          { provide: OrderConversionService, useValue: mockOrderConversionService },
          { provide: OrderValidationService, useValue: mockOrderValidationService },
          { provide: EventEmitter2, useValue: mockEventEmitter },
          {
            provide: slippageLimitsConfig.KEY,
            useValue: { maxSlippageBps: 100, warnSlippageBps: 50, abortOnHighSlippage: false, enabled: false }
          }
        ]
      }).compile();

      const disabledService = disabledModule.get<TradeExecutionService>(TradeExecutionService);
      const mockExchangeClient = buildExchangeClient();
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);

      const slippageSpy = jest.spyOn(disabledService as any, 'estimateSlippageFromOrderBook');

      await disabledService.executeTradeSignal(baseSignal);

      expect(slippageSpy).not.toHaveBeenCalled();
      expect(mockExchangeClient.createMarketOrder).toHaveBeenCalled();
    });

    // --- Happy path ---

    it('should execute a market order and persist slippage details', async () => {
      const mockExchangeClient = buildExchangeClient();
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);
      jest.spyOn(service as any, 'estimateSlippageFromOrderBook').mockResolvedValue(10);

      const result = await service.executeTradeSignal(baseSignal);

      expect(mockExchangeClient.loadMarkets).toHaveBeenCalled();
      expect(mockExchangeClient.createMarketOrder).toHaveBeenCalledWith('BTC/USDT', 'buy', 1);
      expect(mockOrderConversionService.convertCcxtOrderToEntity).toHaveBeenCalled();
      expect(result.symbol).toBe('BTC/USDT');
      expect(result.expectedPrice).toBe(100);
      expect(result.actualSlippageBps).toBe(100);
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('High slippage detected'));
    });

    it('should use bid price when executing a SELL signal', async () => {
      const mockExchangeClient = buildExchangeClient({
        fetchTicker: jest.fn().mockResolvedValue({ ask: 100, bid: 95, last: 96 }),
        createMarketOrder: jest.fn().mockResolvedValue(buildCcxtOrder({ average: 94.05, price: 94.05, side: 'sell' }))
      });
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);
      jest.spyOn(service as any, 'estimateSlippageFromOrderBook').mockResolvedValue(10);

      const result = await service.executeTradeSignal({ ...baseSignal, action: 'SELL' });

      expect(mockExchangeClient.createMarketOrder).toHaveBeenCalledWith('BTC/USDT', 'sell', 1);
      expect(result.expectedPrice).toBe(95);
    });

    // --- Auto-sizing ---

    it('should auto-size quantity from portfolio allocation', async () => {
      const mockExchangeClient = setupHappyPath();
      const signal = {
        ...baseSignal,
        autoSize: true,
        portfolioValue: 10000,
        allocationPercentage: 10,
        quantity: 0
      };

      await service.executeTradeSignal(signal);

      // 10% of $10,000 = $1,000 / $100 (ask) = 10 units
      expect(mockExchangeClient.createMarketOrder).toHaveBeenCalledWith('BTC/USDT', 'buy', 10);
    });

    it('should fall back to signal quantity when allocationPercentage is missing', async () => {
      const mockExchangeClient = setupHappyPath();
      const signal = { ...baseSignal, autoSize: true, portfolioValue: 10000, quantity: 3 };

      await service.executeTradeSignal(signal);

      expect(mockExchangeClient.createMarketOrder).toHaveBeenCalledWith('BTC/USDT', 'buy', 3);
    });

    it('should fall back to signal quantity when portfolioValue is 0', async () => {
      const mockExchangeClient = setupHappyPath();
      const signal = { ...baseSignal, autoSize: true, portfolioValue: 0, quantity: 1 };

      await service.executeTradeSignal(signal);

      expect(mockExchangeClient.createMarketOrder).toHaveBeenCalledWith('BTC/USDT', 'buy', 1);
    });

    it('should reject zero effective quantity', async () => {
      const mockExchangeClient = buildExchangeClient();
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);
      const signal = { ...baseSignal, quantity: 0 };

      await expect(service.executeTradeSignal(signal)).rejects.toBeInstanceOf(ValidationException);
      expect(mockExchangeClient.createMarketOrder).not.toHaveBeenCalled();
    });

    // --- Event emission ---

    it('should emit TRADE_EXECUTED event on success', async () => {
      setupHappyPath();

      await service.executeTradeSignal(baseSignal);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.TRADE_EXECUTED,
        expect.objectContaining({
          userId: 'user-id',
          action: 'BUY',
          symbol: 'BTC/USDT',
          exchangeName: 'Binance',
          orderId: 'order-id'
        })
      );
    });

    it('should emit TRADE_ERROR event on failure', async () => {
      mockExchangeKeyService.findOne.mockRejectedValue(new Error('DB down'));

      await expect(service.executeTradeSignal(baseSignal)).rejects.toThrow('DB down');

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.TRADE_ERROR,
        expect.objectContaining({
          userId: 'user-id',
          symbol: 'BTC/USDT',
          action: 'BUY',
          errorMessage: 'DB down'
        })
      );
    });

    // --- Exit orders ---

    it('should attach exit orders when exitConfig has enabled options', async () => {
      setupHappyPath();
      const signal = {
        ...baseSignal,
        exitConfig: { enableStopLoss: true, enableTakeProfit: true, enableTrailingStop: false }
      };

      await service.executeTradeSignal(signal);

      expect(mockPositionManagementService.attachExitOrders).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'order-id' }),
        signal.exitConfig,
        undefined
      );
    });

    it('should not throw when exit order attachment fails', async () => {
      setupHappyPath();
      mockPositionManagementService.attachExitOrders.mockRejectedValue(new Error('Exit order failed'));
      const signal = {
        ...baseSignal,
        exitConfig: { enableStopLoss: true, enableTakeProfit: false, enableTrailingStop: false }
      };

      // Should complete without throwing — entry order succeeded
      const result = await service.executeTradeSignal(signal);
      expect(result.id).toBe('order-id');
    });

    it('should skip exit orders when no exitConfig is provided', async () => {
      setupHappyPath();

      await service.executeTradeSignal(baseSignal);

      expect(mockPositionManagementService.attachExitOrders).not.toHaveBeenCalled();
    });

    // --- Futures ---

    it('should place a futures order with capped leverage', async () => {
      const mockFuturesService = {
        supportsFutures: true,
        createFuturesOrder: jest.fn().mockResolvedValue(buildCcxtOrder({ side: 'buy' }))
      };
      const mockExchangeClient = setupHappyPath();
      mockExchangeManagerService.getExchangeService.mockReturnValue(mockFuturesService);

      const signal = {
        ...baseSignal,
        marketType: MarketType.FUTURES as const,
        leverage: 5,
        positionSide: 'long' as const
      };

      await service.executeTradeSignal(signal);

      expect(mockFuturesService.createFuturesOrder).toHaveBeenCalledWith(mockUser, 'BTC/USDT', 'buy', 1, 5, {
        positionSide: 'long'
      });
      expect(mockExchangeClient.createMarketOrder).not.toHaveBeenCalled();
    });

    it('should throw when exchange does not support futures', async () => {
      setupHappyPath();
      mockExchangeManagerService.getExchangeService.mockReturnValue({ supportsFutures: false });

      const signal = { ...baseSignal, marketType: MarketType.FUTURES as const };

      await expect(service.executeTradeSignal(signal)).rejects.toBeInstanceOf(ValidationException);
    });
  });

  describe('integration: slippage estimation from real order book', () => {
    it('should calculate slippage from realistic order book data without stubbing estimateSlippageFromOrderBook', async () => {
      const mockExchangeClient = buildExchangeClient({
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [
            [50000, 0.5],
            [50100, 0.5],
            [50200, 1.0]
          ],
          bids: [[49900, 1.0]]
        }),
        fetchTicker: jest.fn().mockResolvedValue({ ask: 50000, bid: 49900, last: 49950 })
      });
      mockExchangeKeyService.findOne.mockResolvedValue({ exchange: mockExchange });
      mockUserRepository.findOneBy.mockResolvedValue(mockUser);
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);

      const result = await service.executeTradeSignal(baseSignal);

      expect(mockExchangeClient.fetchOrderBook).toHaveBeenCalledWith('BTC/USDT', 20);
      expect(result).toBeDefined();
    });
  });

  describe('integration: fund check during execution', () => {
    it('should log warning when funds are insufficient but still attempt trade', async () => {
      const mockExchangeClient = buildExchangeClient({
        fetchBalance: jest.fn().mockResolvedValue({ USDT: { free: 10 } }),
        fetchTicker: jest.fn().mockResolvedValue({ ask: 50000, bid: 49900, last: 49950 })
      });
      mockExchangeKeyService.findOne.mockResolvedValue({ exchange: mockExchange });
      mockUserRepository.findOneBy.mockResolvedValue(mockUser);
      mockExchangeManagerService.getExchangeClient.mockResolvedValue(mockExchangeClient);
      jest.spyOn(service as any, 'estimateSlippageFromOrderBook').mockResolvedValue(0);

      const result = await service.executeTradeSignal(baseSignal);

      expect(result).toBeDefined();
      expect(mockExchangeClient.createMarketOrder).toHaveBeenCalled();
    });
  });

  describe('estimateSlippageFromOrderBook', () => {
    const estimateSlippage = (...args: any[]) => (service as any).estimateSlippageFromOrderBook.call(service, ...args);

    it('should return 0 for empty order book', async () => {
      const client = { fetchOrderBook: jest.fn().mockResolvedValue({ asks: [], bids: [] }) };
      expect(await estimateSlippage(client, 'BTC/USDT', 1, 'BUY', 50000)).toBe(0);
    });

    it('should calculate slippage for BUY using asks', async () => {
      const client = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [
            [50000, 0.5],
            [50100, 0.5],
            [50200, 1.0]
          ],
          bids: [[49900, 1.0]]
        })
      };
      // 0.5@50000 + 0.5@50100 = 50050 VWAP → 10 bps
      expect(await estimateSlippage(client, 'BTC/USDT', 1, 'BUY', 50000)).toBeCloseTo(10, 0);
    });

    it('should calculate slippage for SELL using bids', async () => {
      const client = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [[50100, 1.0]],
          bids: [
            [50000, 0.5],
            [49900, 0.5],
            [49800, 1.0]
          ]
        })
      };
      // 0.5@50000 + 0.5@49900 = 49950 VWAP → 10 bps
      expect(await estimateSlippage(client, 'BTC/USDT', 1, 'SELL', 50000)).toBeCloseTo(10, 0);
    });

    it('should apply worst-case estimate for insufficient BUY liquidity', async () => {
      const client = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [
            [50000, 0.5],
            [50100, 0.3]
          ],
          bids: []
        })
      };
      // 0.5@50000 + 0.3@50100 + 0.2@(50100*1.01) → ~30.04 bps
      expect(await estimateSlippage(client, 'BTC/USDT', 1, 'BUY', 50000)).toBeCloseTo(30.04, 2);
    });

    it('should apply worst-case estimate for insufficient SELL liquidity', async () => {
      const client = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [],
          bids: [
            [50000, 0.5],
            [49900, 0.3]
          ]
        })
      };
      expect(await estimateSlippage(client, 'BTC/USDT', 1, 'SELL', 50000)).toBeCloseTo(29.96, 2);
    });

    it('should return 0 when fetchOrderBook throws', async () => {
      const client = { fetchOrderBook: jest.fn().mockRejectedValue(new Error('API error')) };
      expect(await estimateSlippage(client, 'BTC/USDT', 1, 'BUY', 50000)).toBe(0);
    });

    it('should return 0 for exact fill at expected price', async () => {
      const client = {
        fetchOrderBook: jest.fn().mockResolvedValue({ asks: [[50000, 1.0]], bids: [] })
      };
      expect(await estimateSlippage(client, 'BTC/USDT', 1, 'BUY', 50000)).toBe(0);
    });

    it('should return absolute value for favorable slippage', async () => {
      const client = {
        fetchOrderBook: jest.fn().mockResolvedValue({ asks: [[49900, 1.0]], bids: [] })
      };
      expect(await estimateSlippage(client, 'BTC/USDT', 1, 'BUY', 50000)).toBe(20);
    });

    it('should handle null order book sides gracefully', async () => {
      const client = {
        fetchOrderBook: jest.fn().mockResolvedValue({ asks: null, bids: null })
      };
      expect(await estimateSlippage(client, 'BTC/USDT', 1, 'BUY', 50000)).toBe(0);
    });

    it('should calculate VWAP correctly across multiple price levels', async () => {
      const client = {
        fetchOrderBook: jest.fn().mockResolvedValue({
          asks: [
            [100, 10],
            [110, 10],
            [120, 10],
            [130, 10]
          ],
          bids: []
        })
      };
      // 10@100 + 10@110 + 5@120 = 2700 → VWAP=108 → 800 bps
      expect(await estimateSlippage(client, 'TEST/USD', 25, 'BUY', 100)).toBeCloseTo(800, 0);
    });
  });

  describe('calculateSlippageBps', () => {
    const calc = (expected: number, actual: number, action: string) =>
      (service as any).calculateSlippageBps(expected, actual, action);

    it.each([
      { desc: 'equal prices', expected: 100, actual: 100, action: 'BUY', bps: 0 },
      { desc: 'zero expected price', expected: 0, actual: 100, action: 'BUY', bps: 0 },
      { desc: 'zero actual price', expected: 100, actual: 0, action: 'BUY', bps: 0 }
    ])('should return 0 for $desc', ({ expected, actual, action, bps }) => {
      expect(calc(expected, actual, action)).toBe(bps);
    });

    it.each([
      { desc: 'unfavorable BUY (paid more)', expected: 100, actual: 101, action: 'BUY', bps: 100 },
      { desc: 'favorable BUY (paid less)', expected: 100, actual: 99, action: 'BUY', bps: -100 },
      { desc: 'unfavorable SELL (received less)', expected: 100, actual: 99, action: 'SELL', bps: 100 },
      { desc: 'favorable SELL (received more)', expected: 100, actual: 101, action: 'SELL', bps: -100 },
      { desc: 'fractional (5 bps)', expected: 10000, actual: 10005, action: 'BUY', bps: 5 }
    ])('should calculate $desc as $bps bps', ({ expected, actual, action, bps }) => {
      expect(calc(expected, actual, action)).toBe(bps);
    });
  });

  describe('calculateTradeSize', () => {
    it.each([
      { desc: '10% of $100k', pct: 10, portfolio: 100000, expected: 10000 },
      { desc: 'defaults to 5% when unset', pct: undefined, portfolio: 100000, expected: 5000 },
      { desc: 'zero portfolio value', pct: 10, portfolio: 0, expected: 0 },
      { desc: '100% allocation', pct: 100, portfolio: 50000, expected: 50000 }
    ])('$desc → $expected', ({ pct, portfolio, expected }) => {
      const activation = pct !== undefined ? { allocationPercentage: pct } : {};
      expect(service.calculateTradeSize(activation as any, portfolio)).toBe(expected);
    });
  });

  describe('checkFundsAvailable', () => {
    const fundsSignal = { ...baseSignal };

    it('should report sufficient funds for BUY when balance covers cost', async () => {
      const client = {
        fetchBalance: jest.fn().mockResolvedValue({ USDT: { free: 60000 } }),
        fetchTicker: jest.fn().mockResolvedValue({ last: 50000 })
      };

      const result = await service.checkFundsAvailable(client as any, fundsSignal);

      expect(result).toEqual({ sufficient: true, available: 60000, required: 50000 });
    });

    it('should report insufficient funds for BUY when balance is too low', async () => {
      const client = {
        fetchBalance: jest.fn().mockResolvedValue({ USDT: { free: 100 } }),
        fetchTicker: jest.fn().mockResolvedValue({ last: 50000 })
      };

      const result = await service.checkFundsAvailable(client as any, fundsSignal);

      expect(result).toEqual({ sufficient: false, available: 100, required: 50000 });
    });

    it('should check base currency balance for SELL orders', async () => {
      const client = {
        fetchBalance: jest.fn().mockResolvedValue({ BTC: { free: 0.5 } })
      };
      const sellSignal = { ...fundsSignal, action: 'SELL' as const, quantity: 1 };

      const result = await service.checkFundsAvailable(client as any, sellSignal);

      expect(result).toEqual({ sufficient: false, available: 0.5, required: 1 });
    });

    it('should return sufficient=true when fetchBalance throws (fail-open)', async () => {
      const client = { fetchBalance: jest.fn().mockRejectedValue(new Error('API error')) };

      const result = await service.checkFundsAvailable(client as any, fundsSignal);

      expect(result).toEqual({ sufficient: true, available: 0, required: 0 });
    });
  });
});
