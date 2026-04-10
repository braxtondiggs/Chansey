import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ExchangeSelectionService } from './exchange-selection.service';

import { Order } from '../../order/order.entity';
import { UserStrategyPosition } from '../../strategy/entities/user-strategy-position.entity';
import { type ExchangeKey } from '../exchange-key/exchange-key.entity';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../exchange-manager.service';

describe('ExchangeSelectionService', () => {
  let service: ExchangeSelectionService;
  let exchangeKeyService: { findAll: jest.Mock; findOne: jest.Mock };
  let exchangeManagerService: { getPrice: jest.Mock; getQuoteAsset: jest.Mock };
  let positionRepo: { findOne: jest.Mock };
  let orderRepo: { createQueryBuilder: jest.Mock };

  const userId = 'user-1';
  const symbol = 'BTC/USDT';

  const makeKey = (overrides: Partial<ExchangeKey> = {}): ExchangeKey =>
    ({ id: 'key-1', isActive: true, exchange: { slug: 'binance' }, ...overrides }) as ExchangeKey;

  const makeQueryBuilder = (result: unknown = null) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result)
  });

  beforeEach(async () => {
    exchangeKeyService = { findAll: jest.fn(), findOne: jest.fn() };
    exchangeManagerService = { getPrice: jest.fn(), getQuoteAsset: jest.fn().mockReturnValue('USDT') };
    positionRepo = { findOne: jest.fn() };
    orderRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeSelectionService,
        { provide: ExchangeKeyService, useValue: exchangeKeyService },
        { provide: ExchangeManagerService, useValue: exchangeManagerService },
        { provide: getRepositoryToken(UserStrategyPosition), useValue: positionRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo }
      ]
    }).compile();

    service = module.get(ExchangeSelectionService);
  });

  describe('selectDefault', () => {
    it('returns the first active key without symbol checks', async () => {
      const key = makeKey();
      exchangeKeyService.findAll.mockResolvedValue([key]);

      const result = await service.selectDefault(userId);

      expect(result).toBe(key);
      expect(exchangeManagerService.getPrice).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no active keys exist', async () => {
      exchangeKeyService.findAll.mockResolvedValue([makeKey({ isActive: false })]);

      await expect(service.selectDefault(userId)).rejects.toThrow(NotFoundException);
    });

    it('returns the first active key when multiple exist', async () => {
      const key1 = makeKey({ id: 'key-1' });
      const key2 = makeKey({ id: 'key-2' });
      exchangeKeyService.findAll.mockResolvedValue([key1, key2]);

      const result = await service.selectDefault(userId);

      expect(result).toBe(key1);
    });
  });

  describe('selectForBuy', () => {
    it('throws NotFoundException when no active keys exist', async () => {
      exchangeKeyService.findAll.mockResolvedValue([makeKey({ isActive: false })]);

      await expect(service.selectForBuy(userId, symbol)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when user has no keys at all', async () => {
      exchangeKeyService.findAll.mockResolvedValue([]);

      await expect(service.selectForBuy(userId, symbol)).rejects.toThrow(NotFoundException);
    });

    it('returns the single active key without checking symbol support', async () => {
      const key = makeKey();
      exchangeKeyService.findAll.mockResolvedValue([key]);

      const result = await service.selectForBuy(userId, symbol);

      expect(result).toBe(key);
      expect(exchangeManagerService.getPrice).not.toHaveBeenCalled();
    });

    it('returns the first key that supports the symbol when multiple keys exist', async () => {
      const key1 = makeKey({ id: 'key-1', exchange: { slug: 'coinbase' } } as Partial<ExchangeKey>);
      const key2 = makeKey({ id: 'key-2', exchange: { slug: 'binance' } } as Partial<ExchangeKey>);
      exchangeKeyService.findAll.mockResolvedValue([key1, key2]);
      exchangeManagerService.getQuoteAsset.mockImplementation((slug: string) => (slug === 'coinbase' ? 'USD' : 'USDT'));
      exchangeManagerService.getPrice.mockRejectedValueOnce(new Error('unsupported')).mockResolvedValueOnce(50000);

      const result = await service.selectForBuy(userId, symbol);

      expect(result).toBe(key2);
      expect(exchangeManagerService.getPrice).toHaveBeenCalledWith('coinbase', 'BTC/USD');
      expect(exchangeManagerService.getPrice).toHaveBeenCalledWith('binance', 'BTC/USDT');
    });

    it('skips keys with no exchange slug', async () => {
      const keyNoSlug = makeKey({ id: 'key-1', exchange: undefined } as Partial<ExchangeKey>);
      const keyWithSlug = makeKey({ id: 'key-2' });
      exchangeKeyService.findAll.mockResolvedValue([keyNoSlug, keyWithSlug]);
      exchangeManagerService.getPrice.mockResolvedValue(50000);

      const result = await service.selectForBuy(userId, symbol);

      expect(result).toBe(keyWithSlug);
      expect(exchangeManagerService.getPrice).toHaveBeenCalledTimes(1);
      expect(exchangeManagerService.getPrice).toHaveBeenCalledWith('binance', 'BTC/USDT');
    });

    it('falls back to first active key when no exchange supports the symbol', async () => {
      const key1 = makeKey({ id: 'key-1' });
      const key2 = makeKey({ id: 'key-2' });
      exchangeKeyService.findAll.mockResolvedValue([key1, key2]);
      exchangeManagerService.getPrice.mockRejectedValue(new Error('unsupported'));

      const result = await service.selectForBuy(userId, symbol);

      expect(result).toBe(key1);
    });
  });

  describe('selectForSell', () => {
    const strategyConfigId = 'strategy-1';

    it('returns position exchange key when position has active key', async () => {
      const key = makeKey({ id: 'pos-key' });
      positionRepo.findOne.mockResolvedValue({ exchangeKeyId: 'pos-key', exchangeKey: key });

      const result = await service.selectForSell(userId, symbol, strategyConfigId);

      expect(result).toBe(key);
      expect(positionRepo.findOne).toHaveBeenCalledWith({
        where: { userId, strategyConfigId, symbol },
        relations: ['exchangeKey', 'exchangeKey.exchange']
      });
    });

    it('falls through when position exists but key is inactive', async () => {
      const inactiveKey = makeKey({ id: 'pos-key', isActive: false });
      positionRepo.findOne.mockResolvedValue({ exchangeKeyId: 'pos-key', exchangeKey: inactiveKey });
      const qb = makeQueryBuilder(null);
      orderRepo.createQueryBuilder.mockReturnValue(qb);
      // Falls all the way to selectForBuy
      const fallbackKey = makeKey({ id: 'fallback' });
      exchangeKeyService.findAll.mockResolvedValue([fallbackKey]);

      const result = await service.selectForSell(userId, symbol, strategyConfigId);

      expect(result).toBe(fallbackKey);
    });

    it('falls through when position has no exchangeKeyId', async () => {
      positionRepo.findOne.mockResolvedValue({ exchangeKeyId: null, exchangeKey: null });
      const qb = makeQueryBuilder(null);
      orderRepo.createQueryBuilder.mockReturnValue(qb);
      const fallbackKey = makeKey({ id: 'fallback' });
      exchangeKeyService.findAll.mockResolvedValue([fallbackKey]);

      const result = await service.selectForSell(userId, symbol, strategyConfigId);

      expect(result).toBe(fallbackKey);
    });

    it('falls through gracefully when position lookup throws', async () => {
      positionRepo.findOne.mockRejectedValue(new Error('db error'));
      const qb = makeQueryBuilder(null);
      orderRepo.createQueryBuilder.mockReturnValue(qb);
      const fallbackKey = makeKey({ id: 'fallback' });
      exchangeKeyService.findAll.mockResolvedValue([fallbackKey]);

      const result = await service.selectForSell(userId, symbol, strategyConfigId);

      expect(result).toBe(fallbackKey);
    });

    it('skips position lookup when no strategyConfigId provided', async () => {
      const qb = makeQueryBuilder(null);
      orderRepo.createQueryBuilder.mockReturnValue(qb);
      const fallbackKey = makeKey({ id: 'fallback' });
      exchangeKeyService.findAll.mockResolvedValue([fallbackKey]);

      const result = await service.selectForSell(userId, symbol);

      expect(positionRepo.findOne).not.toHaveBeenCalled();
      expect(result).toBe(fallbackKey);
    });

    it('returns key from most recent filled BUY order', async () => {
      positionRepo.findOne.mockResolvedValue(null);
      const orderKey = makeKey({ id: 'order-key' });
      const qb = makeQueryBuilder({ exchangeKeyId: 'order-key' });
      orderRepo.createQueryBuilder.mockReturnValue(qb);
      exchangeKeyService.findOne.mockResolvedValue(orderKey);

      const result = await service.selectForSell(userId, symbol, strategyConfigId);

      expect(exchangeKeyService.findOne).toHaveBeenCalledWith('order-key', userId);
      expect(result).toBe(orderKey);
    });

    it('falls through when BUY order key is inactive', async () => {
      positionRepo.findOne.mockResolvedValue(null);
      const inactiveKey = makeKey({ id: 'order-key', isActive: false });
      const qb = makeQueryBuilder({ exchangeKeyId: 'order-key' });
      orderRepo.createQueryBuilder.mockReturnValue(qb);
      exchangeKeyService.findOne.mockResolvedValue(inactiveKey);
      const fallbackKey = makeKey({ id: 'fallback' });
      exchangeKeyService.findAll.mockResolvedValue([fallbackKey]);

      const result = await service.selectForSell(userId, symbol, strategyConfigId);

      expect(result).toBe(fallbackKey);
    });

    it('falls through gracefully when order lookup throws', async () => {
      positionRepo.findOne.mockResolvedValue(null);
      orderRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockRejectedValue(new Error('db error'))
      });
      const fallbackKey = makeKey({ id: 'fallback' });
      exchangeKeyService.findAll.mockResolvedValue([fallbackKey]);

      const result = await service.selectForSell(userId, symbol, strategyConfigId);

      expect(result).toBe(fallbackKey);
    });

    it('falls back to selectForBuy when no position or order history exists', async () => {
      positionRepo.findOne.mockResolvedValue(null);
      const qb = makeQueryBuilder(null);
      orderRepo.createQueryBuilder.mockReturnValue(qb);
      const buyKey = makeKey({ id: 'buy-key' });
      exchangeKeyService.findAll.mockResolvedValue([buyKey]);

      const result = await service.selectForSell(userId, symbol, strategyConfigId);

      expect(exchangeKeyService.findAll).toHaveBeenCalledWith(userId);
      expect(result).toBe(buyKey);
    });
  });
});
