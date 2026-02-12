import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import * as ccxt from 'ccxt';
import { DataSource, Repository } from 'typeorm';

import { PositionMonitorTask } from './position-monitor.task';

import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { PositionExit } from '../entities/position-exit.entity';
import {
  DEFAULT_EXIT_CONFIG,
  ExitConfig,
  PositionExitStatus,
  TrailingActivationType,
  TrailingType
} from '../interfaces/exit-config.interface';
import { Order, OrderStatus } from '../order.entity';
import { PositionManagementService } from '../services/position-management.service';

describe('PositionMonitorTask', () => {
  let task: PositionMonitorTask;
  let positionExitRepo: Repository<PositionExit>;
  let positionManagementService: PositionManagementService;
  let exchangeManagerService: ExchangeManagerService;
  let exchangeKeyService: ExchangeKeyService;

  type PositionExitOverrides = Omit<Partial<PositionExit>, 'exitConfig' | 'user'> & {
    exitConfig?: Partial<ExitConfig>;
    user?: { id: string };
  };

  const buildPositionExit = (overrides: PositionExitOverrides = {}) => {
    const { exitConfig, user, ...rest } = overrides;

    return {
      id: 'pos-123',
      symbol: 'BTC/USD',
      exchangeKeyId: 'ex-1',
      side: 'BUY',
      userId: 'user-1',
      entryPrice: 50000,
      exitConfig: {
        ...DEFAULT_EXIT_CONFIG,
        trailingActivation: TrailingActivationType.IMMEDIATE,
        trailingType: TrailingType.PERCENTAGE,
        trailingValue: 2,
        ...exitConfig
      },
      status: PositionExitStatus.ACTIVE,
      ...rest,
      user: (user ?? { id: 'user-1' }) as any
    } as PositionExit;
  };

  const buildQueryBuilder = (positions: PositionExit[]) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(positions)
  });

  const buildExchangeClient = (overrides: Partial<ccxt.Exchange> = {}) =>
    ({
      has: { createStopOrder: true, createOrder: true },
      cancelOrder: jest.fn().mockResolvedValue({}),
      createOrder: jest.fn().mockResolvedValue({
        id: 'new-exchange-order-456',
        clientOrderId: 'client-456',
        timestamp: Date.now(),
        info: { raw: true }
      }),
      ...overrides
    }) as unknown as ccxt.Exchange;

  const mockQueue = {
    add: jest.fn(),
    getRepeatableJobs: jest.fn().mockResolvedValue([])
  };

  const mockPositionExitRepo = {
    createQueryBuilder: jest.fn(),
    save: jest.fn()
  };

  const mockOrderRepo = {
    findOne: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn((entity) => Promise.resolve({ ...entity, id: entity.id || 'new-order-uuid' }))
  };

  const mockPositionManagementService = {
    getActiveTrailingStops: jest.fn()
  };

  const mockExchangeManagerService = {
    getExchangeClient: jest.fn()
  };

  const mockExchangeKeyService = {
    findOne: jest.fn()
  };

  const mockManager = {
    save: jest.fn((entityClass, entity) => Promise.resolve({ ...entity, id: entity.id || 'new-order-uuid' })),
    create: jest.fn((entityClass, dto) => dto)
  };

  const mockDataSource = {
    transaction: jest.fn((cb) => cb(mockManager))
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionMonitorTask,
        { provide: getQueueToken('position-monitor'), useValue: mockQueue },
        { provide: getRepositoryToken(PositionExit), useValue: mockPositionExitRepo },
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: PositionManagementService, useValue: mockPositionManagementService },
        { provide: ExchangeManagerService, useValue: mockExchangeManagerService },
        { provide: ExchangeKeyService, useValue: mockExchangeKeyService },
        { provide: DataSource, useValue: mockDataSource }
      ]
    }).compile();

    task = module.get<PositionMonitorTask>(PositionMonitorTask);
    positionExitRepo = module.get(getRepositoryToken(PositionExit));
    positionManagementService = module.get(PositionManagementService);
    exchangeManagerService = module.get(ExchangeManagerService);
    exchangeKeyService = module.get(ExchangeKeyService);

    jest.clearAllMocks();
  });

  describe('shouldActivateTrailing', () => {
    it('should activate immediately when set to IMMEDIATE', () => {
      const position = buildPositionExit({
        exitConfig: { trailingActivation: TrailingActivationType.IMMEDIATE }
      });

      const result = (task as any).shouldActivateTrailing(position, 51000);

      expect(result).toBe(true);
    });

    it('should activate when price exceeds activation price for long', () => {
      const position = buildPositionExit({
        exitConfig: {
          trailingActivation: TrailingActivationType.PRICE,
          trailingActivationValue: 52000
        }
      });

      // Price below activation
      expect((task as any).shouldActivateTrailing(position, 51000)).toBe(false);
      // Price at activation
      expect((task as any).shouldActivateTrailing(position, 52000)).toBe(true);
      // Price above activation
      expect((task as any).shouldActivateTrailing(position, 53000)).toBe(true);
    });

    it('should activate when price falls below activation price for short', () => {
      const position = buildPositionExit({
        side: 'SELL',
        exitConfig: {
          trailingActivation: TrailingActivationType.PRICE,
          trailingActivationValue: 48000
        }
      });

      // Price above activation (not activated for shorts)
      expect((task as any).shouldActivateTrailing(position, 49000)).toBe(false);
      // Price at activation
      expect((task as any).shouldActivateTrailing(position, 48000)).toBe(true);
      // Price below activation
      expect((task as any).shouldActivateTrailing(position, 47000)).toBe(true);
    });

    it('should activate based on percentage gain for long', () => {
      const position = buildPositionExit({
        exitConfig: {
          trailingActivation: TrailingActivationType.PERCENTAGE,
          trailingActivationValue: 2 // 2% gain
        }
      });

      // Target: 50000 * 1.02 = 51000
      expect((task as any).shouldActivateTrailing(position, 50500)).toBe(false);
      expect((task as any).shouldActivateTrailing(position, 51000)).toBe(true);
      expect((task as any).shouldActivateTrailing(position, 52000)).toBe(true);
    });

    it('should activate based on percentage gain for short', () => {
      const position = buildPositionExit({
        side: 'SELL',
        exitConfig: {
          trailingActivation: TrailingActivationType.PERCENTAGE,
          trailingActivationValue: 2 // 2% gain (price drop for shorts)
        }
      });

      // Target: 50000 * 0.98 = 49000
      expect((task as any).shouldActivateTrailing(position, 49500)).toBe(false);
      expect((task as any).shouldActivateTrailing(position, 49000)).toBe(true);
      expect((task as any).shouldActivateTrailing(position, 48000)).toBe(true);
    });

    it('should return false for unknown activation type', () => {
      const position = buildPositionExit({
        exitConfig: { trailingActivation: 'unknown' as TrailingActivationType }
      });

      expect((task as any).shouldActivateTrailing(position, 55000)).toBe(false);
    });
  });

  describe('calculateTrailingStopPrice', () => {
    it('should calculate amount-based trailing stop for long', () => {
      const config = {
        trailingType: TrailingType.AMOUNT,
        trailingValue: 500 // $500 trailing
      };

      const result = (task as any).calculateTrailingStopPrice(52000, config, 'BUY');

      // 52000 - 500 = 51500
      expect(result).toBe(51500);
    });

    it('should calculate amount-based trailing stop for short', () => {
      const config = {
        trailingType: TrailingType.AMOUNT,
        trailingValue: 500
      };

      const result = (task as any).calculateTrailingStopPrice(48000, config, 'SELL');

      // 48000 + 500 = 48500
      expect(result).toBe(48500);
    });

    it('should calculate percentage-based trailing stop for long', () => {
      const config = {
        trailingType: TrailingType.PERCENTAGE,
        trailingValue: 2 // 2%
      };

      const result = (task as any).calculateTrailingStopPrice(52000, config, 'BUY');

      // 52000 - (52000 * 0.02) = 52000 - 1040 = 50960
      expect(result).toBe(50960);
    });

    it('should calculate percentage-based trailing stop for short', () => {
      const config = {
        trailingType: TrailingType.PERCENTAGE,
        trailingValue: 2
      };

      const result = (task as any).calculateTrailingStopPrice(48000, config, 'SELL');

      // 48000 + (48000 * 0.02) = 48000 + 960 = 48960
      expect(result).toBe(48960);
    });

    it('should calculate ATR-based trailing stop', () => {
      const config = {
        trailingType: TrailingType.ATR,
        trailingValue: 2 // 2x ATR multiplier
      };

      const result = (task as any).calculateTrailingStopPrice(52000, config, 'BUY', 1000);

      // 52000 - (1000 * 2) = 50000
      expect(result).toBe(50000);
    });

    it('should fallback to 2% when entryAtr is unavailable', () => {
      const config = {
        trailingType: TrailingType.ATR,
        trailingValue: 2
      };

      const result = (task as any).calculateTrailingStopPrice(50000, config, 'BUY', undefined);

      // Default 2%: 50000 - (50000 * 0.02) = 49000
      expect(result).toBe(49000);
    });

    it('should use default 2% for unknown trailing type', () => {
      const config = {
        trailingType: 'unknown' as TrailingType,
        trailingValue: 1
      };

      const result = (task as any).calculateTrailingStopPrice(50000, config, 'BUY');

      // Default 2%: 50000 - (50000 * 0.02) = 49000
      expect(result).toBe(49000);
    });
  });

  describe('process', () => {
    const mockJob = {
      id: 'job-123',
      name: 'monitor-positions',
      updateProgress: jest.fn()
    } as unknown as Job;

    it('should handle unknown job type', async () => {
      const unknownJob = { ...mockJob, name: 'unknown-job' } as Job;

      const result = await task.process(unknownJob);

      expect(result).toEqual({
        success: false,
        message: 'Unknown job type: unknown-job'
      });
    });

    it('should return early when no active trailing positions', async () => {
      mockPositionExitRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([]));

      const result = await task.process(mockJob);

      expect(result).toEqual({
        monitored: 0,
        updated: 0,
        triggered: 0,
        timestamp: expect.any(String)
      });
    });

    it('should monitor positions and return update counts', async () => {
      const position = buildPositionExit({
        id: 'pos-1',
        exitConfig: { trailingType: TrailingType.PERCENTAGE, trailingValue: 2 }
      });
      mockPositionExitRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([position]));

      mockExchangeKeyService.findOne.mockResolvedValue({ exchange: { slug: 'binance' } });
      mockExchangeManagerService.getExchangeClient.mockResolvedValue({
        fetchTicker: jest.fn().mockResolvedValue({ last: 51000 })
      });

      const updateSpy = jest
        .spyOn(task as any, 'updateTrailingStop')
        .mockResolvedValue({ updated: true, triggered: false });

      const result = await task.process(mockJob);

      expect(updateSpy).toHaveBeenCalledWith(expect.any(Object), 51000, expect.any(Object));
      expect(result).toEqual({
        monitored: 1,
        updated: 1,
        triggered: 0,
        timestamp: expect.any(String)
      });
      expect(mockJob.updateProgress).toHaveBeenCalled();
    });

    it('should skip positions when exchange key is missing', async () => {
      const position = buildPositionExit({
        id: 'pos-1',
        exchangeKeyId: 'ex-missing',
        exitConfig: { trailingType: TrailingType.PERCENTAGE, trailingValue: 2 }
      });
      mockPositionExitRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([position]));
      mockExchangeKeyService.findOne.mockResolvedValue(null);

      const updateSpy = jest
        .spyOn(task as any, 'updateTrailingStop')
        .mockResolvedValue({ updated: true, triggered: false });

      const result = await task.process(mockJob);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(result).toEqual({
        monitored: 1,
        updated: 0,
        triggered: 0,
        timestamp: expect.any(String)
      });
    });
  });

  describe('updateTrailingStop', () => {
    const mockExchangeClient = {
      fetchTicker: jest.fn()
    };

    it('should activate trailing stop when conditions met', async () => {
      const position = buildPositionExit({
        trailingActivated: false,
        trailingHighWaterMark: undefined,
        trailingLowWaterMark: undefined,
        currentTrailingStopPrice: undefined,
        exitConfig: {
          trailingActivation: TrailingActivationType.IMMEDIATE,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        }
      });

      mockPositionExitRepo.save.mockResolvedValue(position);

      const result = await (task as any).updateTrailingStop(position, 51000, mockExchangeClient);

      expect(result.updated).toBe(true);
      expect(position.trailingActivated).toBe(true);
      expect(position.trailingHighWaterMark).toBe(51000);
    });

    it('should update trailing stop for long when price makes new high', async () => {
      const position = buildPositionExit({
        trailingActivated: true,
        trailingHighWaterMark: 52000,
        currentTrailingStopPrice: 50960, // 52000 - 2%
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        }
      });

      mockPositionExitRepo.save.mockResolvedValue(position);

      // New high at 54000
      const result = await (task as any).updateTrailingStop(position, 54000, mockExchangeClient);

      expect(result.updated).toBe(true);
      expect(position.trailingHighWaterMark).toBe(54000);
      // New stop: 54000 - (54000 * 0.02) = 52920
      expect(position.currentTrailingStopPrice).toBe(52920);
    });

    it('should NOT update trailing stop when price below high water mark (ratchet)', async () => {
      const position = buildPositionExit({
        trailingActivated: true,
        trailingHighWaterMark: 54000,
        currentTrailingStopPrice: 52920,
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        }
      });

      // Price drops but still above stop
      const result = await (task as any).updateTrailingStop(position, 53000, mockExchangeClient);

      expect(result.updated).toBe(false);
      expect(position.trailingHighWaterMark).toBe(54000); // Unchanged
      expect(position.currentTrailingStopPrice).toBe(52920); // Unchanged
    });

    it('should trigger stop loss for long when price falls below stop', async () => {
      const position = buildPositionExit({
        trailingActivated: true,
        trailingHighWaterMark: 54000,
        currentTrailingStopPrice: 52920,
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        }
      });

      mockPositionExitRepo.save.mockResolvedValue(position);

      // Price falls below stop
      const result = await (task as any).updateTrailingStop(position, 52000, mockExchangeClient);

      expect(result.triggered).toBe(true);
      expect(position.status).toBe(PositionExitStatus.TRAILING_TRIGGERED);
      expect(position.exitPrice).toBe(52000);
    });

    it('should update trailing stop for short when price makes new low', async () => {
      const position = buildPositionExit({
        side: 'SELL',
        trailingActivated: true,
        trailingLowWaterMark: 48000,
        currentTrailingStopPrice: 48960, // 48000 + 2%
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        }
      });

      mockPositionExitRepo.save.mockResolvedValue(position);

      // New low at 46000
      const result = await (task as any).updateTrailingStop(position, 46000, mockExchangeClient);

      expect(result.updated).toBe(true);
      expect(position.trailingLowWaterMark).toBe(46000);
      // New stop: 46000 + (46000 * 0.02) = 46920
      expect(position.currentTrailingStopPrice).toBe(46920);
    });

    it('should trigger stop loss for short when price rises above stop', async () => {
      const position = buildPositionExit({
        side: 'SELL',
        trailingActivated: true,
        trailingLowWaterMark: 46000,
        currentTrailingStopPrice: 46920,
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        }
      });

      mockPositionExitRepo.save.mockResolvedValue(position);

      // Price rises above stop
      const result = await (task as any).updateTrailingStop(position, 47500, mockExchangeClient);

      expect(result.triggered).toBe(true);
      expect(position.status).toBe(PositionExitStatus.TRAILING_TRIGGERED);
      expect(position.exitPrice).toBe(47500);
    });
  });

  describe('onModuleInit', () => {
    const envSnapshot = {
      NODE_ENV: process.env.NODE_ENV,
      DISABLE_POSITION_MONITOR: process.env.DISABLE_POSITION_MONITOR
    };

    afterEach(() => {
      process.env.NODE_ENV = envSnapshot.NODE_ENV;
      process.env.DISABLE_POSITION_MONITOR = envSnapshot.DISABLE_POSITION_MONITOR;
    });

    it('should not schedule jobs in development mode', async () => {
      process.env.NODE_ENV = 'development';

      await task.onModuleInit();

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should not schedule jobs when DISABLE_POSITION_MONITOR is true', async () => {
      process.env.DISABLE_POSITION_MONITOR = 'true';

      await task.onModuleInit();

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('updateStopOrderOnExchange', () => {
    it('should cancel old order and create new one (happy path)', async () => {
      const position = buildPositionExit({
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 0.5,
        trailingStopOrderId: 'old-order-uuid',
        exchangeKeyId: 'ex-key-1',
        warnings: []
      });
      const existingOrder = {
        id: 'old-order-uuid',
        orderId: 'exchange-order-123',
        status: OrderStatus.NEW
      };

      mockOrderRepo.findOne.mockResolvedValue(existingOrder);

      const exchangeClient = buildExchangeClient();

      await (task as any).updateStopOrderOnExchange(position, 52000, exchangeClient);

      // Old order cancelled on exchange
      expect(exchangeClient.cancelOrder).toHaveBeenCalledWith('exchange-order-123', 'BTC/USDT');

      // Transaction was used for DB writes
      expect(mockDataSource.transaction).toHaveBeenCalled();

      // Old order marked CANCELED via manager
      expect(mockManager.save).toHaveBeenCalledWith(Order, expect.objectContaining({ status: OrderStatus.CANCELED }));

      // New order created on exchange
      expect(exchangeClient.createOrder).toHaveBeenCalledWith('BTC/USDT', 'stop_loss', 'sell', 0.5, undefined, {
        stopPrice: 52000
      });

      // New order saved via manager
      expect(mockManager.create).toHaveBeenCalledWith(
        Order,
        expect.objectContaining({
          symbol: 'BTC/USDT',
          orderId: 'new-exchange-order-456',
          stopPrice: 52000
        })
      );

      // Position reference updated
      expect(position.trailingStopOrderId).toBe('new-order-uuid');
    });

    it('should clear reference and not create new order when cancel gets OrderNotFound', async () => {
      const position = buildPositionExit({
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 0.5,
        trailingStopOrderId: 'old-order-uuid',
        exchangeKeyId: 'ex-key-1',
        warnings: []
      });
      const existingOrder = {
        id: 'old-order-uuid',
        orderId: 'exchange-order-123',
        status: OrderStatus.NEW
      };

      mockOrderRepo.findOne.mockResolvedValue(existingOrder);

      const exchangeClient = buildExchangeClient({
        cancelOrder: jest.fn().mockRejectedValue(new ccxt.OrderNotFound('not found')),
        createOrder: jest.fn()
      });

      await (task as any).updateStopOrderOnExchange(position, 52000, exchangeClient);

      // Reference cleared
      expect(position.trailingStopOrderId).toBeUndefined();

      // Old order marked CANCELED
      expect(existingOrder.status).toBe(OrderStatus.CANCELED);

      // createOrder NOT called
      expect(exchangeClient.createOrder).not.toHaveBeenCalled();
    });

    it('should set ERROR status when cancel succeeds but create fails', async () => {
      const position = buildPositionExit({
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 0.5,
        trailingStopOrderId: 'old-order-uuid',
        exchangeKeyId: 'ex-key-1',
        warnings: []
      });
      const existingOrder = {
        id: 'old-order-uuid',
        orderId: 'exchange-order-123',
        status: OrderStatus.NEW
      };

      mockOrderRepo.findOne.mockResolvedValue(existingOrder);

      const createError = new Error('Insufficient balance');
      const exchangeClient = buildExchangeClient({
        cancelOrder: jest.fn().mockResolvedValue({}),
        createOrder: jest.fn().mockRejectedValue(createError)
      });

      await expect((task as any).updateStopOrderOnExchange(position, 52000, exchangeClient)).rejects.toThrow(
        'Insufficient balance'
      );

      // Position marked as ERROR
      expect(position.status).toBe(PositionExitStatus.ERROR);

      // Reference cleared
      expect(position.trailingStopOrderId).toBeUndefined();

      // Warning added
      expect(position.warnings).toHaveLength(1);
      expect(position.warnings?.[0]).toContain('Insufficient balance');

      // Position saved with error state
      expect(mockPositionExitRepo.save).toHaveBeenCalledWith(position);
    });

    it('should return silently when exchange does not support stop orders', async () => {
      const position = buildPositionExit({
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 0.5,
        trailingStopOrderId: 'old-order-uuid',
        exchangeKeyId: 'ex-key-1',
        warnings: []
      });
      const exchangeClient = buildExchangeClient({
        has: { createStopOrder: false, createOrder: false }
      });

      await (task as any).updateStopOrderOnExchange(position, 52000, exchangeClient);

      // No exchange calls made
      expect(exchangeClient.cancelOrder).not.toHaveBeenCalled();
      expect(exchangeClient.createOrder).not.toHaveBeenCalled();

      // No DB lookups for order
      expect(mockOrderRepo.findOne).not.toHaveBeenCalled();
    });

    it('should clear reference when order not found in DB', async () => {
      const position = buildPositionExit({
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 0.5,
        trailingStopOrderId: 'old-order-uuid',
        exchangeKeyId: 'ex-key-1',
        warnings: []
      });

      mockOrderRepo.findOne.mockResolvedValue(null);

      const exchangeClient = buildExchangeClient();

      await (task as any).updateStopOrderOnExchange(position, 52000, exchangeClient);

      // Reference cleared
      expect(position.trailingStopOrderId).toBeUndefined();

      // No exchange calls made
      expect(exchangeClient.cancelOrder).not.toHaveBeenCalled();
      expect(exchangeClient.createOrder).not.toHaveBeenCalled();
    });

    it('should re-throw non-OrderNotFound cancel errors', async () => {
      const position = buildPositionExit({
        symbol: 'BTC/USDT',
        side: 'BUY',
        quantity: 0.5,
        trailingStopOrderId: 'old-order-uuid',
        exchangeKeyId: 'ex-key-1',
        warnings: []
      });
      const existingOrder = {
        id: 'old-order-uuid',
        orderId: 'exchange-order-123',
        status: OrderStatus.NEW
      };

      mockOrderRepo.findOne.mockResolvedValue(existingOrder);

      const networkError = new ccxt.NetworkError('Connection refused');
      const exchangeClient = buildExchangeClient({
        cancelOrder: jest.fn().mockRejectedValue(networkError),
        createOrder: jest.fn()
      });

      await expect((task as any).updateStopOrderOnExchange(position, 52000, exchangeClient)).rejects.toThrow(
        'Connection refused'
      );

      // createOrder NOT called
      expect(exchangeClient.createOrder).not.toHaveBeenCalled();
    });

    it('should early-return from updateTrailingStop when position enters ERROR state', async () => {
      const position = buildPositionExit({
        trailingActivated: true,
        trailingHighWaterMark: 52000,
        currentTrailingStopPrice: 50960,
        trailingStopOrderId: 'old-order-uuid',
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        },
        user: { id: 'user-1' },
        quantity: 0.5,
        symbol: 'BTC/USDT',
        warnings: []
      });

      // Simulate updateStopOrderOnExchange setting ERROR status
      const updateStopSpy = jest
        .spyOn(task as any, 'updateStopOrderOnExchange')
        .mockImplementation(async (pos: unknown) => {
          (pos as PositionExit).status = PositionExitStatus.ERROR;
        });

      mockPositionExitRepo.save.mockResolvedValue(position);

      // Price at 54000 triggers a new high -> should attempt to update stop
      const result = await (task as any).updateTrailingStop(position, 54000, {});

      expect(updateStopSpy).toHaveBeenCalled();

      // Early return: updated true, triggered false
      expect(result).toEqual({ updated: true, triggered: false });

      // currentTrailingStopPrice should NOT be updated (still at old value)
      expect(position.currentTrailingStopPrice).toBe(50960);
    });
  });
});
