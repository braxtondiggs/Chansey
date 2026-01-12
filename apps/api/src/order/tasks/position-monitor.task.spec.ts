import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { PositionMonitorTask } from './position-monitor.task';

import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { PositionExit } from '../entities/position-exit.entity';
import { PositionExitStatus, TrailingActivationType, TrailingType } from '../interfaces/exit-config.interface';
import { PositionManagementService } from '../services/position-management.service';

describe('PositionMonitorTask', () => {
  let task: PositionMonitorTask;
  let positionExitRepo: Repository<PositionExit>;
  let positionManagementService: PositionManagementService;
  let exchangeManagerService: ExchangeManagerService;
  let exchangeKeyService: ExchangeKeyService;

  const mockQueue = {
    add: jest.fn(),
    getRepeatableJobs: jest.fn().mockResolvedValue([])
  };

  const mockPositionExitRepo = {
    createQueryBuilder: jest.fn(),
    save: jest.fn()
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionMonitorTask,
        { provide: getQueueToken('position-monitor'), useValue: mockQueue },
        { provide: getRepositoryToken(PositionExit), useValue: mockPositionExitRepo },
        { provide: PositionManagementService, useValue: mockPositionManagementService },
        { provide: ExchangeManagerService, useValue: mockExchangeManagerService },
        { provide: ExchangeKeyService, useValue: mockExchangeKeyService }
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
      const position = {
        exitConfig: {
          trailingActivation: TrailingActivationType.IMMEDIATE
        },
        side: 'BUY',
        entryPrice: 50000
      } as PositionExit;

      const result = (task as any).shouldActivateTrailing(position, 51000);

      expect(result).toBe(true);
    });

    it('should activate when price exceeds activation price for long', () => {
      const position = {
        exitConfig: {
          trailingActivation: TrailingActivationType.PRICE,
          trailingActivationValue: 52000
        },
        side: 'BUY',
        entryPrice: 50000
      } as PositionExit;

      // Price below activation
      expect((task as any).shouldActivateTrailing(position, 51000)).toBe(false);
      // Price at activation
      expect((task as any).shouldActivateTrailing(position, 52000)).toBe(true);
      // Price above activation
      expect((task as any).shouldActivateTrailing(position, 53000)).toBe(true);
    });

    it('should activate when price falls below activation price for short', () => {
      const position = {
        exitConfig: {
          trailingActivation: TrailingActivationType.PRICE,
          trailingActivationValue: 48000
        },
        side: 'SELL',
        entryPrice: 50000
      } as PositionExit;

      // Price above activation (not activated for shorts)
      expect((task as any).shouldActivateTrailing(position, 49000)).toBe(false);
      // Price at activation
      expect((task as any).shouldActivateTrailing(position, 48000)).toBe(true);
      // Price below activation
      expect((task as any).shouldActivateTrailing(position, 47000)).toBe(true);
    });

    it('should activate based on percentage gain for long', () => {
      const position = {
        exitConfig: {
          trailingActivation: TrailingActivationType.PERCENTAGE,
          trailingActivationValue: 2 // 2% gain
        },
        side: 'BUY',
        entryPrice: 50000
      } as PositionExit;

      // Target: 50000 * 1.02 = 51000
      expect((task as any).shouldActivateTrailing(position, 50500)).toBe(false);
      expect((task as any).shouldActivateTrailing(position, 51000)).toBe(true);
      expect((task as any).shouldActivateTrailing(position, 52000)).toBe(true);
    });

    it('should activate based on percentage gain for short', () => {
      const position = {
        exitConfig: {
          trailingActivation: TrailingActivationType.PERCENTAGE,
          trailingActivationValue: 2 // 2% gain (price drop for shorts)
        },
        side: 'SELL',
        entryPrice: 50000
      } as PositionExit;

      // Target: 50000 * 0.98 = 49000
      expect((task as any).shouldActivateTrailing(position, 49500)).toBe(false);
      expect((task as any).shouldActivateTrailing(position, 49000)).toBe(true);
      expect((task as any).shouldActivateTrailing(position, 48000)).toBe(true);
    });

    it('should return false for unknown activation type', () => {
      const position = {
        exitConfig: {
          trailingActivation: 'unknown' as TrailingActivationType
        },
        side: 'BUY',
        entryPrice: 50000
      } as PositionExit;

      expect((task as any).shouldActivateTrailing(position, 55000)).toBe(false);
    });
  });

  describe('calculateTrailingStopPrice', () => {
    it('should calculate amount-based trailing stop for long', () => {
      const position = {
        side: 'BUY',
        exitConfig: {
          trailingType: TrailingType.AMOUNT,
          trailingValue: 500 // $500 trailing
        }
      } as PositionExit;

      const result = (task as any).calculateTrailingStopPrice(52000, position);

      // 52000 - 500 = 51500
      expect(result).toBe(51500);
    });

    it('should calculate amount-based trailing stop for short', () => {
      const position = {
        side: 'SELL',
        exitConfig: {
          trailingType: TrailingType.AMOUNT,
          trailingValue: 500
        }
      } as PositionExit;

      const result = (task as any).calculateTrailingStopPrice(48000, position);

      // 48000 + 500 = 48500
      expect(result).toBe(48500);
    });

    it('should calculate percentage-based trailing stop for long', () => {
      const position = {
        side: 'BUY',
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2 // 2%
        }
      } as PositionExit;

      const result = (task as any).calculateTrailingStopPrice(52000, position);

      // 52000 - (52000 * 0.02) = 52000 - 1040 = 50960
      expect(result).toBe(50960);
    });

    it('should calculate percentage-based trailing stop for short', () => {
      const position = {
        side: 'SELL',
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        }
      } as PositionExit;

      const result = (task as any).calculateTrailingStopPrice(48000, position);

      // 48000 + (48000 * 0.02) = 48000 + 960 = 48960
      expect(result).toBe(48960);
    });

    it('should calculate ATR-based trailing stop using stored entryAtr', () => {
      const position = {
        side: 'BUY',
        entryAtr: 1000, // ATR value stored at entry
        exitConfig: {
          trailingType: TrailingType.ATR,
          trailingValue: 2 // 2x ATR multiplier for trailing
        }
      } as PositionExit;

      const result = (task as any).calculateTrailingStopPrice(52000, position);

      // 52000 - (1000 * 2) = 50000
      expect(result).toBe(50000);
    });

    it('should fallback to 2% for ATR trailing when entryAtr is missing', () => {
      const position = {
        side: 'BUY',
        entryAtr: undefined, // No ATR stored
        exitConfig: {
          trailingType: TrailingType.ATR,
          trailingValue: 2
        }
      } as PositionExit;

      const result = (task as any).calculateTrailingStopPrice(50000, position);

      // Fallback 2%: 50000 - (50000 * 0.02) = 49000
      expect(result).toBe(49000);
    });

    it('should use default 2% for unknown trailing type', () => {
      const position = {
        side: 'BUY',
        exitConfig: {
          trailingType: 'unknown' as TrailingType,
          trailingValue: 1
        }
      } as PositionExit;

      const result = (task as any).calculateTrailingStopPrice(50000, position);

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
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };
      mockPositionExitRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await task.process(mockJob);

      expect(result).toEqual({
        monitored: 0,
        updated: 0,
        triggered: 0,
        timestamp: expect.any(String)
      });
    });

    it('should monitor positions and return update counts', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'pos-1',
            symbol: 'BTC/USD',
            exchangeKeyId: 'ex-1',
            side: 'BUY',
            userId: 'user-1',
            user: { id: 'user-1' },
            entryPrice: 50000,
            exitConfig: { trailingType: TrailingType.PERCENTAGE, trailingValue: 2 }
          } as PositionExit
        ])
      };
      mockPositionExitRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

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
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'pos-1',
            symbol: 'BTC/USD',
            exchangeKeyId: 'ex-missing',
            side: 'BUY',
            userId: 'user-1',
            user: { id: 'user-1' },
            entryPrice: 50000,
            exitConfig: { trailingType: TrailingType.PERCENTAGE, trailingValue: 2 }
          } as PositionExit
        ])
      };
      mockPositionExitRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
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
      const position = {
        id: 'pos-123',
        side: 'BUY',
        entryPrice: 50000,
        trailingActivated: false,
        trailingHighWaterMark: undefined,
        trailingLowWaterMark: undefined,
        currentTrailingStopPrice: undefined,
        exitConfig: {
          trailingActivation: TrailingActivationType.IMMEDIATE,
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        },
        status: PositionExitStatus.ACTIVE
      } as unknown as PositionExit;

      mockPositionExitRepo.save.mockResolvedValue(position);

      const result = await (task as any).updateTrailingStop(position, 51000, mockExchangeClient);

      expect(result.updated).toBe(true);
      expect(position.trailingActivated).toBe(true);
      expect(position.trailingHighWaterMark).toBe(51000);
    });

    it('should update trailing stop for long when price makes new high', async () => {
      const position = {
        id: 'pos-123',
        side: 'BUY',
        entryPrice: 50000,
        trailingActivated: true,
        trailingHighWaterMark: 52000,
        currentTrailingStopPrice: 50960, // 52000 - 2%
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        },
        status: PositionExitStatus.ACTIVE
      } as unknown as PositionExit;

      mockPositionExitRepo.save.mockResolvedValue(position);

      // New high at 54000
      const result = await (task as any).updateTrailingStop(position, 54000, mockExchangeClient);

      expect(result.updated).toBe(true);
      expect(position.trailingHighWaterMark).toBe(54000);
      // New stop: 54000 - (54000 * 0.02) = 52920
      expect(position.currentTrailingStopPrice).toBe(52920);
    });

    it('should NOT update trailing stop when price below high water mark (ratchet)', async () => {
      const position = {
        id: 'pos-123',
        side: 'BUY',
        entryPrice: 50000,
        trailingActivated: true,
        trailingHighWaterMark: 54000,
        currentTrailingStopPrice: 52920,
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        },
        status: PositionExitStatus.ACTIVE
      } as unknown as PositionExit;

      // Price drops but still above stop
      const result = await (task as any).updateTrailingStop(position, 53000, mockExchangeClient);

      expect(result.updated).toBe(false);
      expect(position.trailingHighWaterMark).toBe(54000); // Unchanged
      expect(position.currentTrailingStopPrice).toBe(52920); // Unchanged
    });

    it('should trigger stop loss for long when price falls below stop', async () => {
      const position = {
        id: 'pos-123',
        side: 'BUY',
        entryPrice: 50000,
        trailingActivated: true,
        trailingHighWaterMark: 54000,
        currentTrailingStopPrice: 52920,
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        },
        status: PositionExitStatus.ACTIVE
      } as unknown as PositionExit;

      mockPositionExitRepo.save.mockResolvedValue(position);

      // Price falls below stop
      const result = await (task as any).updateTrailingStop(position, 52000, mockExchangeClient);

      expect(result.triggered).toBe(true);
      expect(position.status).toBe(PositionExitStatus.TRAILING_TRIGGERED);
      expect(position.exitPrice).toBe(52000);
    });

    it('should update trailing stop for short when price makes new low', async () => {
      const position = {
        id: 'pos-123',
        side: 'SELL',
        entryPrice: 50000,
        trailingActivated: true,
        trailingLowWaterMark: 48000,
        currentTrailingStopPrice: 48960, // 48000 + 2%
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        },
        status: PositionExitStatus.ACTIVE
      } as unknown as PositionExit;

      mockPositionExitRepo.save.mockResolvedValue(position);

      // New low at 46000
      const result = await (task as any).updateTrailingStop(position, 46000, mockExchangeClient);

      expect(result.updated).toBe(true);
      expect(position.trailingLowWaterMark).toBe(46000);
      // New stop: 46000 + (46000 * 0.02) = 46920
      expect(position.currentTrailingStopPrice).toBe(46920);
    });

    it('should trigger stop loss for short when price rises above stop', async () => {
      const position = {
        id: 'pos-123',
        side: 'SELL',
        entryPrice: 50000,
        trailingActivated: true,
        trailingLowWaterMark: 46000,
        currentTrailingStopPrice: 46920,
        exitConfig: {
          trailingType: TrailingType.PERCENTAGE,
          trailingValue: 2
        },
        status: PositionExitStatus.ACTIVE
      } as unknown as PositionExit;

      mockPositionExitRepo.save.mockResolvedValue(position);

      // Price rises above stop
      const result = await (task as any).updateTrailingStop(position, 47500, mockExchangeClient);

      expect(result.triggered).toBe(true);
      expect(position.status).toBe(PositionExitStatus.TRAILING_TRIGGERED);
      expect(position.exitPrice).toBe(47500);
    });
  });

  describe('onModuleInit', () => {
    it('should not schedule jobs in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      await task.onModuleInit();

      expect(mockQueue.add).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });

    it('should not schedule jobs when DISABLE_POSITION_MONITOR is true', async () => {
      const originalEnv = process.env.DISABLE_POSITION_MONITOR;
      process.env.DISABLE_POSITION_MONITOR = 'true';

      await task.onModuleInit();

      expect(mockQueue.add).not.toHaveBeenCalled();

      process.env.DISABLE_POSITION_MONITOR = originalEnv;
    });
  });
});
