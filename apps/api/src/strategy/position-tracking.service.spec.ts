import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ObjectLiteral, Repository } from 'typeorm';

import { UserStrategyPosition } from './entities/user-strategy-position.entity';
import { PositionTrackingService } from './position-tracking.service';

type MockRepo<T extends ObjectLiteral> = jest.Mocked<Repository<T>>;

const createPosition = (overrides: Partial<UserStrategyPosition> = {}): UserStrategyPosition =>
  ({
    id: 'pos-1',
    userId: 'user-1',
    strategyConfigId: 'strat-1',
    symbol: 'BTC/USDT',
    positionSide: 'long',
    quantity: 0,
    avgEntryPrice: 0,
    unrealizedPnL: 0,
    realizedPnL: 0,
    ...overrides
  }) as UserStrategyPosition;

describe('PositionTrackingService', () => {
  let service: PositionTrackingService;
  let repo: MockRepo<UserStrategyPosition>;

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data) => ({ ...createPosition(), ...data })),
      save: jest.fn((entity) => Promise.resolve(entity))
    } as unknown as MockRepo<UserStrategyPosition>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [PositionTrackingService, { provide: getRepositoryToken(UserStrategyPosition), useValue: repo }]
    }).compile();

    service = module.get(PositionTrackingService);
  });

  describe('getPositions', () => {
    it('queries all positions for a user without strategy filter', async () => {
      repo.find.mockResolvedValue([]);
      await service.getPositions('user-1');
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        relations: ['strategyConfig', 'user'],
        order: { updatedAt: 'DESC' }
      });
    });

    it('includes strategyConfigId in query when provided', async () => {
      repo.find.mockResolvedValue([]);
      await service.getPositions('user-1', 'strat-1');
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1', strategyConfigId: 'strat-1' },
        relations: ['strategyConfig', 'user'],
        order: { updatedAt: 'DESC' }
      });
    });
  });

  describe('getPosition', () => {
    it('queries with positionSide=long by default', async () => {
      repo.findOne.mockResolvedValue(null);
      await service.getPosition('user-1', 'strat-1', 'BTC/USDT');
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', strategyConfigId: 'strat-1', symbol: 'BTC/USDT', positionSide: 'long' },
        relations: ['strategyConfig', 'user']
      });
    });

    it('queries with positionSide=short when specified', async () => {
      repo.findOne.mockResolvedValue(null);
      await service.getPosition('user-1', 'strat-1', 'BTC/USDT', 'short');
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', strategyConfigId: 'strat-1', symbol: 'BTC/USDT', positionSide: 'short' },
        relations: ['strategyConfig', 'user']
      });
    });
  });

  describe('updatePosition - long', () => {
    it('creates a new long position on buy', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.updatePosition('user-1', 'strat-1', 'BTC/USDT', 1, 50000, 'buy');

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ positionSide: 'long' }));
      expect(result.quantity).toBe(1);
      expect(result.avgEntryPrice).toBe(50000);
    });

    it('adds to existing position with weighted average entry price', async () => {
      const existing = createPosition({ quantity: 1, avgEntryPrice: 50000 });
      repo.findOne.mockResolvedValue(existing);

      const result = await service.updatePosition('user-1', 'strat-1', 'BTC/USDT', 1, 60000, 'buy');

      // Weighted avg: (1 * 50000 + 1 * 60000) / 2 = 55000
      expect(result.quantity).toBe(2);
      expect(result.avgEntryPrice).toBe(55000);
    });

    it('realizes positive P&L on full sell when price rises', async () => {
      const existing = createPosition({ quantity: 1, avgEntryPrice: 50000 });
      repo.findOne.mockResolvedValue(existing);

      const result = await service.updatePosition('user-1', 'strat-1', 'BTC/USDT', 1, 55000, 'sell');

      // P&L = (55000 - 50000) * 1 = 5000
      expect(result.realizedPnL).toBe(5000);
      expect(result.quantity).toBe(0);
      expect(result.avgEntryPrice).toBe(0);
      expect(result.unrealizedPnL).toBe(0);
    });

    it('realizes negative P&L on full sell when price drops', async () => {
      const existing = createPosition({ quantity: 1, avgEntryPrice: 50000 });
      repo.findOne.mockResolvedValue(existing);

      const result = await service.updatePosition('user-1', 'strat-1', 'BTC/USDT', 1, 45000, 'sell');

      // P&L = (45000 - 50000) * 1 = -5000
      expect(result.realizedPnL).toBe(-5000);
      expect(result.quantity).toBe(0);
    });

    it('partially sells a position preserving remaining quantity and avg price', async () => {
      const existing = createPosition({ quantity: 2, avgEntryPrice: 50000 });
      repo.findOne.mockResolvedValue(existing);

      const result = await service.updatePosition('user-1', 'strat-1', 'BTC/USDT', 1, 55000, 'sell');

      // P&L on 1 unit: (55000 - 50000) * 1 = 5000
      expect(result.realizedPnL).toBe(5000);
      expect(result.quantity).toBe(1);
      expect(result.avgEntryPrice).toBe(50000);
    });
  });

  describe('updatePosition - short', () => {
    it('creates a new short position on buy', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.updatePosition('user-1', 'strat-1', 'BTC/USDT', 1, 50000, 'buy', 'short');

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ positionSide: 'short' }));
      expect(result.quantity).toBe(1);
      expect(result.avgEntryPrice).toBe(50000);
    });

    it.each([
      { exitPrice: 45000, expectedPnL: 5000, desc: 'positive P&L when price drops' },
      { exitPrice: 55000, expectedPnL: -5000, desc: 'negative P&L when price rises' }
    ])('realizes $desc on short exit', async ({ exitPrice, expectedPnL }) => {
      const existing = createPosition({ positionSide: 'short', quantity: 1, avgEntryPrice: 50000 });
      repo.findOne.mockResolvedValue(existing);

      const result = await service.updatePosition('user-1', 'strat-1', 'BTC/USDT', 1, exitPrice, 'sell', 'short');

      expect(result.realizedPnL).toBe(expectedPnL);
      expect(result.quantity).toBe(0);
    });

    it('does not collide short and long positions for the same symbol', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.updatePosition('user-1', 'strat-1', 'BTC/USDT', 1, 50000, 'buy', 'long');
      await service.updatePosition('user-1', 'strat-1', 'BTC/USDT', 0.5, 50000, 'buy', 'short');

      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ positionSide: 'long' }) })
      );
      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ positionSide: 'short' }) })
      );
    });
  });

  describe('calculateUnrealizedPnL', () => {
    it('calculates positive unrealized P&L for long position', async () => {
      const position = createPosition({ quantity: 1, avgEntryPrice: 50000, positionSide: 'long' });
      repo.find.mockResolvedValue([position]);

      const result = await service.calculateUnrealizedPnL('user-1', 'strat-1', new Map([['BTC/USDT', 55000]]));

      expect(result).toBe(5000);
      expect(position.unrealizedPnL).toBe(5000);
    });

    it.each([
      { side: 'short' as const, price: 45000, expected: 5000, desc: 'positive for short when price drops' },
      { side: 'short' as const, price: 55000, expected: -5000, desc: 'negative for short when price rises' },
      { side: 'long' as const, price: 45000, expected: -5000, desc: 'negative for long when price drops' }
    ])('calculates $desc', async ({ side, price, expected }) => {
      const position = createPosition({ quantity: 1, avgEntryPrice: 50000, positionSide: side });
      repo.find.mockResolvedValue([position]);

      const result = await service.calculateUnrealizedPnL('user-1', 'strat-1', new Map([['BTC/USDT', price]]));

      expect(result).toBe(expected);
      expect(position.unrealizedPnL).toBe(expected);
    });

    it('skips positions with no current price or zero quantity', async () => {
      const noPrice = createPosition({ quantity: 1, avgEntryPrice: 50000, symbol: 'ETH/USDT' });
      const zeroQty = createPosition({ quantity: 0, avgEntryPrice: 50000, symbol: 'BTC/USDT' });
      repo.find.mockResolvedValue([noPrice, zeroQty]);

      const result = await service.calculateUnrealizedPnL(
        'user-1',
        'strat-1',
        new Map([['BTC/USDT', 55000]]) // no ETH/USDT price
      );

      expect(result).toBe(0);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('closePosition', () => {
    it('closes long position with correct P&L', async () => {
      const position = createPosition({ quantity: 1, avgEntryPrice: 50000 });
      repo.findOne.mockResolvedValue(position);

      await service.closePosition('user-1', 'strat-1', 'BTC/USDT', 55000);

      expect(position.realizedPnL).toBe(5000);
      expect(position.quantity).toBe(0);
      expect(position.avgEntryPrice).toBe(0);
      expect(position.unrealizedPnL).toBe(0);
      expect(repo.save).toHaveBeenCalledWith(position);
    });

    it.each([
      { exitPrice: 45000, expectedPnL: 5000, desc: 'profit when price drops' },
      { exitPrice: 55000, expectedPnL: -5000, desc: 'loss when price rises' }
    ])('closes short position with $desc', async ({ exitPrice, expectedPnL }) => {
      const position = createPosition({ positionSide: 'short', quantity: 1, avgEntryPrice: 50000 });
      repo.findOne.mockResolvedValue(position);

      await service.closePosition('user-1', 'strat-1', 'BTC/USDT', exitPrice, 'short');

      expect(position.realizedPnL).toBe(expectedPnL);
      expect(position.quantity).toBe(0);
    });

    it('returns early without saving when no position exists', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.closePosition('user-1', 'strat-1', 'BTC/USDT', 50000);

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('returns early without saving when position quantity is zero', async () => {
      const position = createPosition({ quantity: 0 });
      repo.findOne.mockResolvedValue(position);

      await service.closePosition('user-1', 'strat-1', 'BTC/USDT', 50000);

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('passes positionSide to getPosition query', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.closePosition('user-1', 'strat-1', 'BTC/USDT', 50000, 'short');

      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ positionSide: 'short' }) })
      );
    });
  });

  describe('getUserTotalPnL', () => {
    it('aggregates realized and unrealized P&L across all positions', async () => {
      repo.find.mockResolvedValue([
        createPosition({ realizedPnL: 1000, unrealizedPnL: 500 }),
        createPosition({ id: 'pos-2', realizedPnL: -300, unrealizedPnL: 200 })
      ]);

      const result = await service.getUserTotalPnL('user-1');

      expect(result).toEqual({ realizedPnL: 700, unrealizedPnL: 700, totalPnL: 1400 });
    });

    it('returns zeros when user has no positions', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.getUserTotalPnL('user-1');

      expect(result).toEqual({ realizedPnL: 0, unrealizedPnL: 0, totalPnL: 0 });
    });
  });

  describe('getStrategyPnL', () => {
    it('aggregates P&L for a specific strategy', async () => {
      repo.find.mockResolvedValue([
        createPosition({ realizedPnL: 2000, unrealizedPnL: -500 }),
        createPosition({ id: 'pos-2', realizedPnL: 800, unrealizedPnL: 300 })
      ]);

      const result = await service.getStrategyPnL('user-1', 'strat-1');

      expect(result).toEqual({ realizedPnL: 2800, unrealizedPnL: -200, totalPnL: 2600 });
    });
  });

  describe('getAllUserPositionsBySymbol', () => {
    it('aggregates multiple positions for the same symbol', async () => {
      repo.find.mockResolvedValue([
        createPosition({
          symbol: 'BTC/USDT',
          quantity: 1,
          avgEntryPrice: 50000,
          realizedPnL: 1000,
          unrealizedPnL: 500
        }),
        createPosition({
          id: 'pos-2',
          symbol: 'BTC/USDT',
          quantity: 2,
          avgEntryPrice: 55000,
          realizedPnL: 200,
          unrealizedPnL: -100
        })
      ]);

      const result = await service.getAllUserPositionsBySymbol('user-1');

      const btc = result.get('BTC/USDT');
      if (!btc) throw new Error('expected BTC/USDT position');
      // Total qty = 3, weighted avg = (1*50000 + 2*55000) / 3 ≈ 53333.33
      expect(btc.quantity).toBe(3);
      expect(btc.avgPrice).toBeCloseTo(53333.33, 1);
      // Total PnL = (1000 + 500) + (200 + -100) = 1600
      expect(btc.pnl).toBe(1600);
    });

    it('separates different symbols into distinct map entries', async () => {
      repo.find.mockResolvedValue([
        createPosition({ symbol: 'BTC/USDT', quantity: 1, avgEntryPrice: 50000, realizedPnL: 100, unrealizedPnL: 0 }),
        createPosition({
          id: 'pos-2',
          symbol: 'ETH/USDT',
          quantity: 10,
          avgEntryPrice: 3000,
          realizedPnL: 50,
          unrealizedPnL: 20
        })
      ]);

      const result = await service.getAllUserPositionsBySymbol('user-1');

      expect(result.size).toBe(2);
      expect(result.get('BTC/USDT')).toEqual({ quantity: 1, avgPrice: 50000, pnl: 100 });
      expect(result.get('ETH/USDT')).toEqual({ quantity: 10, avgPrice: 3000, pnl: 70 });
    });
  });
});
