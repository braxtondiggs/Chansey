import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { DataSource } from 'typeorm';

import { OcoOrderService } from './oco-order.service';

import { CoinService } from '../../coin/coin.service';
import { type User } from '../../users/users.entity';
import { OrderSide, OrderType } from '../order.entity';

describe('OcoOrderService', () => {
  let service: OcoOrderService;
  let queryRunner: any;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  const mockUser: User = { id: 'user-123' } as User;
  const mockExchangeKey: any = {
    id: 'ek-1',
    exchange: { id: 'ex-1', slug: 'binance', name: 'Binance' }
  };

  const baseDto: any = {
    exchangeKeyId: 'ek-1',
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    orderType: OrderType.OCO,
    quantity: 0.01,
    takeProfitPrice: 55000,
    stopLossPrice: 45000
  };

  const makeExchangeStub = (overrides: any = {}) => ({
    createOrder: jest.fn().mockResolvedValue({ id: 'ex-1', clientOrderId: 'co-1', info: {} }),
    cancelOrder: jest.fn().mockResolvedValue({}),
    ...overrides
  });

  beforeEach(async () => {
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        create: jest.fn((_e, data) => ({ id: `order-${Math.random()}`, ...data })),
        save: jest.fn((order) => Promise.resolve(order))
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcoOrderService,
        { provide: DataSource, useValue: { createQueryRunner: jest.fn().mockReturnValue(queryRunner) } },
        { provide: CoinService, useValue: { getMultipleCoinsBySymbol: jest.fn().mockResolvedValue([]) } }
      ]
    }).compile();

    service = module.get(OcoOrderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerErrorSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });

  it('creates both TP and SL orders, cross-links them, and commits', async () => {
    const savedOrders: any[] = [];
    queryRunner.manager.create = jest.fn((_e, data) => ({ id: `order-${savedOrders.length + 1}`, ...data }));
    queryRunner.manager.save = jest.fn((order) => {
      savedOrders.push(order);
      return Promise.resolve(order);
    });

    const stub = makeExchangeStub({
      createOrder: jest
        .fn()
        .mockResolvedValueOnce({ id: 'tp-1', clientOrderId: 'tp-1', info: { tp: true } })
        .mockResolvedValueOnce({ id: 'sl-1', clientOrderId: 'sl-1', info: { sl: true } })
    });

    const result = await service.createOcoOrder(baseDto, mockUser, stub as any, mockExchangeKey);

    expect(stub.createOrder).toHaveBeenCalledTimes(2);
    expect(stub.createOrder).toHaveBeenNthCalledWith(1, 'BTC/USDT', 'limit', 'buy', 0.01, 55000);
    expect(stub.createOrder).toHaveBeenNthCalledWith(2, 'BTC/USDT', 'stop_loss', 'buy', 0.01, undefined, {
      stopPrice: 45000
    });
    // 3 saves: TP insert, SL insert, TP update with cross-link
    expect(queryRunner.manager.save).toHaveBeenCalledTimes(3);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    expect(result.type).toBe(OrderType.TAKE_PROFIT);
    expect(result.ocoLinkedOrderId).toBe(savedOrders[1].id);
    expect(savedOrders[1].type).toBe(OrderType.STOP_LOSS);
    expect(savedOrders[1].ocoLinkedOrderId).toBe(result.id);
  });

  it('commits successfully and logs warning when coin lookup fails', async () => {
    const coinService = (service as any).coinService;
    coinService.getMultipleCoinsBySymbol = jest.fn().mockRejectedValue(new Error('coin svc down'));

    const stub = makeExchangeStub({
      createOrder: jest
        .fn()
        .mockResolvedValueOnce({ id: 'tp-1', clientOrderId: 'tp-1', info: {} })
        .mockResolvedValueOnce({ id: 'sl-1', clientOrderId: 'sl-1', info: {} })
    });

    await service.createOcoOrder(baseDto, mockUser, stub as any, mockExchangeKey);

    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find coins'));
  });

  it('cancels TP and rolls back when SL creation fails', async () => {
    const stub = makeExchangeStub({
      createOrder: jest
        .fn()
        .mockResolvedValueOnce({ id: 'tp-1', clientOrderId: 'tp-1', info: {} })
        .mockRejectedValueOnce(new Error('sl failed'))
    });

    await expect(service.createOcoOrder(baseDto, mockUser, stub as any, mockExchangeKey)).rejects.toThrow();

    expect(stub.cancelOrder).toHaveBeenCalledWith('tp-1', 'BTC/USDT');
    // SL fails in Phase 1 (before transaction). No DB connection should be opened.
    expect(queryRunner.connect).not.toHaveBeenCalled();
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('logs CRITICAL when TP cancel also fails after SL failure', async () => {
    const stub = makeExchangeStub({
      createOrder: jest
        .fn()
        .mockResolvedValueOnce({ id: 'tp-1', clientOrderId: 'tp-1', info: {} })
        .mockRejectedValueOnce(new Error('sl failed')),
      cancelOrder: jest.fn().mockRejectedValue(new Error('cancel failed'))
    });

    await expect(service.createOcoOrder(baseDto, mockUser, stub as any, mockExchangeKey)).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to cancel take-profit'));
  });

  it('logs CRITICAL reconciliation, cancels both exchange legs, and rolls back when DB save fails', async () => {
    const stub = makeExchangeStub({
      createOrder: jest
        .fn()
        .mockResolvedValueOnce({ id: 'tp-1', clientOrderId: 'tp-1', info: {} })
        .mockResolvedValueOnce({ id: 'sl-1', clientOrderId: 'sl-1', info: {} })
    });
    queryRunner.manager.save.mockRejectedValueOnce(new Error('db down'));

    await expect(service.createOcoOrder(baseDto, mockUser, stub as any, mockExchangeKey)).rejects.toThrow();

    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    // Best-effort cleanup: both legs should be canceled on the exchange
    expect(stub.cancelOrder).toHaveBeenCalledWith('tp-1', 'BTC/USDT');
    expect(stub.cancelOrder).toHaveBeenCalledWith('sl-1', 'BTC/USDT');
    const critical = loggerErrorSpy.mock.calls.filter((c) => String(c[0]).includes('CRITICAL'));
    expect(critical.length).toBeGreaterThan(0);
  });
});
