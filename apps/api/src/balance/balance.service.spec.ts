import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { type Cache } from 'cache-manager';

import { BalanceService } from './balance.service';
import { type AssetBalanceDto, type ExchangeBalanceDto } from './dto';

import { type Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { type User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

// ── Helpers ──────────────────────────────────────────────────────────

const mockUser = { id: 'user-1', email: 'test@test.com' } as User;

function makeExchangeKey(
  overrides: Partial<{ exchangeId: string; slug: string; name: string; isActive: boolean }> = {}
) {
  return {
    id: 'key-1',
    exchangeId: 'ex-1',
    slug: 'binance_us',
    name: 'Binance US',
    isActive: true,
    ...overrides
  };
}

function makeAssetBalance(overrides: Partial<AssetBalanceDto> = {}): AssetBalanceDto {
  return { asset: 'BTC', free: '1.0', locked: '0.0', usdValue: undefined, ...overrides };
}

function makeCoin(overrides: Partial<Coin> = {}): Coin {
  return {
    id: 'coin-btc',
    symbol: 'BTC',
    name: 'Bitcoin',
    slug: 'bitcoin',
    currentPrice: 50000,
    priceChangePercentage24h: 2.5,
    image: 'https://img/btc.png',
    ...overrides
  } as Coin;
}

// ── Test Suite ───────────────────────────────────────────────────────

describe('BalanceService', () => {
  let service: BalanceService;
  let exchangeManager: jest.Mocked<ExchangeManagerService>;
  let coinService: jest.Mocked<CoinService>;
  let usersService: jest.Mocked<UsersService>;
  let cacheManager: jest.Mocked<Cache>;
  let mockExchangeService: { getBalance: jest.Mock };

  beforeEach(async () => {
    mockExchangeService = { getBalance: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceService,
        {
          provide: ExchangeManagerService,
          useValue: {
            getExchangeService: jest.fn().mockReturnValue(mockExchangeService),
            getQuoteAsset: jest.fn().mockReturnValue('USD'),
            getPrice: jest.fn()
          }
        },
        {
          provide: CoinService,
          useValue: { getMultipleCoinsBySymbol: jest.fn() }
        },
        {
          provide: UsersService,
          useValue: { getExchangeKeysForUser: jest.fn() }
        },
        {
          provide: CACHE_MANAGER,
          useValue: { get: jest.fn(), set: jest.fn() }
        }
      ]
    }).compile();

    service = module.get(BalanceService);
    exchangeManager = module.get(ExchangeManagerService) as jest.Mocked<ExchangeManagerService>;
    coinService = module.get(CoinService) as jest.Mocked<CoinService>;
    usersService = module.get(UsersService) as jest.Mocked<UsersService>;
    cacheManager = module.get(CACHE_MANAGER) as jest.Mocked<Cache>;

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // ── getCurrentBalances ──────────────────────────────────────────

  describe('getCurrentBalances', () => {
    it('should return cached balances on cache hit', async () => {
      const cached: ExchangeBalanceDto[] = [
        { id: 'ex-1', slug: 'binance_us', name: 'Binance US', balances: [], totalUsdValue: 100, timestamp: new Date() }
      ];
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.getCurrentBalances(mockUser);

      expect(result).toBe(cached);
      expect(usersService.getExchangeKeysForUser).not.toHaveBeenCalled();
    });

    it('should fetch from exchanges on cache miss and cache the result', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      usersService.getExchangeKeysForUser.mockResolvedValue([makeExchangeKey()]);
      mockExchangeService.getBalance.mockResolvedValue([makeAssetBalance()]);
      exchangeManager.getPrice.mockResolvedValue({ symbol: 'BTC/USD', price: '50000', timestamp: Date.now() });

      const result = await service.getCurrentBalances(mockUser);

      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('binance_us');
      expect(result[0].balances).toHaveLength(1);
      expect(cacheManager.set).toHaveBeenCalledWith(`balance:user:${mockUser.id}:current`, expect.any(Array), 60_000);
    });

    it('should skip inactive exchange keys', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      usersService.getExchangeKeysForUser.mockResolvedValue([
        makeExchangeKey({ isActive: true, slug: 'binance_us', name: 'Binance US' }),
        makeExchangeKey({ isActive: false, slug: 'gdax', name: 'Coinbase' })
      ]);
      mockExchangeService.getBalance.mockResolvedValue([makeAssetBalance()]);
      exchangeManager.getPrice.mockResolvedValue({ symbol: 'BTC/USD', price: '50000', timestamp: Date.now() });

      const result = await service.getCurrentBalances(mockUser);

      // Only the active exchange should produce a result
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('binance_us');
    });
  });

  // ── fetchExchangeBalance (via getCurrentBalances) ───────────────

  describe('fetchExchangeBalance', () => {
    beforeEach(() => {
      cacheManager.get.mockResolvedValue(undefined);
      usersService.getExchangeKeysForUser.mockResolvedValue([makeExchangeKey()]);
    });

    it('should return empty DTO when exchange service is not found', async () => {
      exchangeManager.getExchangeService.mockImplementation(() => {
        throw new Error('No handler for exchange');
      });

      const result = await service.getCurrentBalances(mockUser);

      expect(result).toHaveLength(1);
      expect(result[0].balances).toEqual([]);
      expect(result[0].totalUsdValue).toBe(0);
    });

    it('should return empty DTO when getBalance throws', async () => {
      mockExchangeService.getBalance.mockRejectedValue(new Error('Exchange API down'));

      const result = await service.getCurrentBalances(mockUser);

      expect(result).toHaveLength(1);
      expect(result[0].balances).toEqual([]);
      expect(result[0].totalUsdValue).toBe(0);
    });

    it('should return empty DTO when getBalance returns no assets', async () => {
      mockExchangeService.getBalance.mockResolvedValue([]);

      const result = await service.getCurrentBalances(mockUser);

      expect(result).toHaveLength(1);
      expect(result[0].balances).toEqual([]);
    });

    it('should calculate USD values for non-stablecoin assets', async () => {
      mockExchangeService.getBalance.mockResolvedValue([
        makeAssetBalance({ asset: 'BTC', free: '2.0', locked: '0.0' }),
        makeAssetBalance({ asset: 'ETH', free: '10.0', locked: '0.0' })
      ]);
      exchangeManager.getPrice
        .mockResolvedValueOnce({ symbol: 'BTC/USD', price: '50000', timestamp: Date.now() })
        .mockResolvedValueOnce({ symbol: 'ETH/USD', price: '3000', timestamp: Date.now() });

      const result = await service.getCurrentBalances(mockUser);

      expect(result[0].totalUsdValue).toBe(130000); // 2*50000 + 10*3000
    });

    it('should use face value for USD-equivalent stablecoins without price lookup', async () => {
      mockExchangeService.getBalance.mockResolvedValue([
        makeAssetBalance({ asset: 'USDT', free: '5000', locked: '500' }),
        makeAssetBalance({ asset: 'USDC', free: '2000', locked: '0' })
      ]);

      const result = await service.getCurrentBalances(mockUser);

      expect(exchangeManager.getPrice).not.toHaveBeenCalled();
      expect(result[0].totalUsdValue).toBe(7500); // 5500 + 2000
    });

    it('should set usdValue to 0 when price lookup fails', async () => {
      mockExchangeService.getBalance.mockResolvedValue([
        makeAssetBalance({ asset: 'SHIB', free: '1000000', locked: '0' })
      ]);
      exchangeManager.getPrice.mockRejectedValue(new Error('No price'));

      const result = await service.getCurrentBalances(mockUser);

      expect(result[0].balances[0].usdValue).toBe(0);
    });

    it('should isolate failures — healthy exchange succeeds when another fails', async () => {
      usersService.getExchangeKeysForUser.mockResolvedValue([
        makeExchangeKey({ exchangeId: 'ex-1', slug: 'binance_us', name: 'Binance US' }),
        makeExchangeKey({ exchangeId: 'ex-2', slug: 'gdax', name: 'Coinbase' })
      ]);

      const failingService = { getBalance: jest.fn().mockRejectedValue(new Error('down')) };
      const healthyService = {
        getBalance: jest.fn().mockResolvedValue([makeAssetBalance({ asset: 'USD', free: '1000', locked: '0' })])
      };

      exchangeManager.getExchangeService
        .mockReturnValueOnce(failingService as any)
        .mockReturnValueOnce(healthyService as any);

      const result = await service.getCurrentBalances(mockUser);

      // Both exchanges were attempted
      expect(failingService.getBalance).toHaveBeenCalledTimes(1);
      expect(healthyService.getBalance).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      // Failed exchange: empty DTO
      expect(result[0].balances).toEqual([]);
      expect(result[0].totalUsdValue).toBe(0);
      // Healthy exchange: has balances
      expect(result[1].balances).toHaveLength(1);
      expect(result[1].totalUsdValue).toBe(1000);
    });
  });

  // ── getUserBalances ─────────────────────────────────────────────

  describe('getUserBalances', () => {
    it('should return total USD value summed across exchanges', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      usersService.getExchangeKeysForUser.mockResolvedValue([
        makeExchangeKey({ exchangeId: 'ex-1', slug: 'binance_us', name: 'Binance US' }),
        makeExchangeKey({ exchangeId: 'ex-2', slug: 'gdax', name: 'Coinbase' })
      ]);
      mockExchangeService.getBalance
        .mockResolvedValueOnce([makeAssetBalance({ asset: 'USDT', free: '3000', locked: '0' })])
        .mockResolvedValueOnce([makeAssetBalance({ asset: 'USD', free: '2000', locked: '0' })]);

      const result = await service.getUserBalances(mockUser);

      expect(result.totalUsdValue).toBe(5000);
      expect(result.current).toHaveLength(2);
    });

    it('should rethrow when getCurrentBalances fails entirely', async () => {
      cacheManager.get.mockRejectedValue(new Error('Redis down'));

      await expect(service.getUserBalances(mockUser)).rejects.toThrow('Redis down');
    });
  });

  // ── getHoldingsForCoin ──────────────────────────────────────────

  describe('getHoldingsForCoin', () => {
    const btcCoin = makeCoin();

    beforeEach(() => {
      cacheManager.get.mockResolvedValue(undefined);
    });

    it('should return null when user holds none of the coin', async () => {
      usersService.getExchangeKeysForUser.mockResolvedValue([makeExchangeKey()]);
      mockExchangeService.getBalance.mockResolvedValue([makeAssetBalance({ asset: 'ETH', free: '10', locked: '0' })]);
      exchangeManager.getPrice.mockResolvedValue({ symbol: 'ETH/USD', price: '3000', timestamp: Date.now() });

      const result = await service.getHoldingsForCoin(mockUser, btcCoin);

      expect(result).toBeNull();
    });

    it('should aggregate holdings across exchanges', async () => {
      usersService.getExchangeKeysForUser.mockResolvedValue([
        makeExchangeKey({ exchangeId: 'ex-1', slug: 'binance_us', name: 'Binance US' }),
        makeExchangeKey({ exchangeId: 'ex-2', slug: 'gdax', name: 'Coinbase' })
      ]);
      mockExchangeService.getBalance
        .mockResolvedValueOnce([makeAssetBalance({ asset: 'BTC', free: '1.5', locked: '0.5' })])
        .mockResolvedValueOnce([makeAssetBalance({ asset: 'BTC', free: '0.5', locked: '0' })]);
      exchangeManager.getPrice.mockResolvedValue({ symbol: 'BTC/USD', price: '50000', timestamp: Date.now() });

      const result = await service.getHoldingsForCoin(mockUser, btcCoin);

      expect(result).toBeDefined();
      expect(result?.totalAmount).toBe(2.5); // 1.5+0.5+0.5
      expect(result?.currentValue).toBe(125000); // 2.5 * 50000
      expect(result?.exchanges).toHaveLength(2);
      expect(result?.averageBuyPrice).toBe(0);
    });

    it('should compute zero currentValue when coin.currentPrice is null', async () => {
      const noPriceCoin = makeCoin({ currentPrice: null });
      usersService.getExchangeKeysForUser.mockResolvedValue([makeExchangeKey()]);
      mockExchangeService.getBalance.mockResolvedValue([makeAssetBalance({ asset: 'BTC', free: '2', locked: '0' })]);
      exchangeManager.getPrice.mockResolvedValue({ symbol: 'BTC/USD', price: '50000', timestamp: Date.now() });

      const result = await service.getHoldingsForCoin(mockUser, noPriceCoin);

      expect(result).toBeDefined();
      expect(result?.totalAmount).toBe(2);
      expect(result?.currentValue).toBe(0);
    });

    it('should match coin symbol case-insensitively', async () => {
      usersService.getExchangeKeysForUser.mockResolvedValue([makeExchangeKey()]);
      mockExchangeService.getBalance.mockResolvedValue([makeAssetBalance({ asset: 'btc', free: '1', locked: '0' })]);
      exchangeManager.getPrice.mockResolvedValue({ symbol: 'BTC/USD', price: '50000', timestamp: Date.now() });

      const result = await service.getHoldingsForCoin(mockUser, btcCoin);

      expect(result).toBeDefined();
      expect(result?.totalAmount).toBe(1);
    });
  });

  // ── getUserAssetDetails ─────────────────────────────────────────

  describe('getUserAssetDetails', () => {
    beforeEach(() => {
      cacheManager.get.mockResolvedValue(undefined);
      usersService.getExchangeKeysForUser.mockResolvedValue([makeExchangeKey()]);
    });

    it('should merge balances of the same asset and sort by USD value descending', async () => {
      // Simulate two exchanges returning BTC and ETH
      usersService.getExchangeKeysForUser.mockResolvedValue([
        makeExchangeKey({ exchangeId: 'ex-1', slug: 'binance_us', name: 'Binance US' }),
        makeExchangeKey({ exchangeId: 'ex-2', slug: 'gdax', name: 'Coinbase' })
      ]);
      mockExchangeService.getBalance
        .mockResolvedValueOnce([
          makeAssetBalance({ asset: 'BTC', free: '1', locked: '0' }),
          makeAssetBalance({ asset: 'ETH', free: '10', locked: '0' })
        ])
        .mockResolvedValueOnce([makeAssetBalance({ asset: 'BTC', free: '0.5', locked: '0' })]);
      exchangeManager.getPrice.mockImplementation(async (_slug: string, symbol: string) => {
        if (symbol.startsWith('BTC')) return { symbol, price: '50000', timestamp: Date.now() };
        if (symbol.startsWith('ETH')) return { symbol, price: '3000', timestamp: Date.now() };
        return { symbol, price: '0', timestamp: Date.now() };
      });

      coinService.getMultipleCoinsBySymbol.mockResolvedValue([
        makeCoin({ symbol: 'BTC', name: 'Bitcoin', slug: 'bitcoin', image: 'btc.png' }),
        makeCoin({ symbol: 'ETH', name: 'Ethereum', slug: 'ethereum', image: 'eth.png' })
      ] as Coin[]);

      const result = await service.getUserAssetDetails(mockUser);

      // BTC: 1.5 * 50000 = 75000, ETH: 10 * 3000 = 30000
      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('BTC');
      expect(result[0].quantity).toBe(1.5);
      expect(result[0].usdValue).toBe(75000);
      expect(result[1].symbol).toBe('ETH');
      expect(result[1].usdValue).toBe(30000);
    });

    it('should skip zero-balance assets', async () => {
      mockExchangeService.getBalance.mockResolvedValue([
        makeAssetBalance({ asset: 'BTC', free: '0', locked: '0' }),
        makeAssetBalance({ asset: 'ETH', free: '1', locked: '0' })
      ]);
      exchangeManager.getPrice.mockResolvedValue({ symbol: 'ETH/USD', price: '3000', timestamp: Date.now() });
      coinService.getMultipleCoinsBySymbol.mockResolvedValue([
        makeCoin({ symbol: 'ETH', name: 'Ethereum', slug: 'ethereum' })
      ] as Coin[]);

      const result = await service.getUserAssetDetails(mockUser);

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('ETH');
    });

    it('should rethrow when an internal error occurs', async () => {
      coinService.getMultipleCoinsBySymbol.mockRejectedValue(new Error('DB connection lost'));
      mockExchangeService.getBalance.mockResolvedValue([makeAssetBalance({ asset: 'BTC', free: '1', locked: '0' })]);
      exchangeManager.getPrice.mockResolvedValue({ symbol: 'BTC/USD', price: '50000', timestamp: Date.now() });

      await expect(service.getUserAssetDetails(mockUser)).rejects.toThrow('DB connection lost');
    });

    it('should use symbol as fallback name when coin metadata is missing', async () => {
      mockExchangeService.getBalance.mockResolvedValue([makeAssetBalance({ asset: 'RARE', free: '100', locked: '0' })]);
      exchangeManager.getPrice.mockResolvedValue({ symbol: 'RARE/USD', price: '1', timestamp: Date.now() });
      coinService.getMultipleCoinsBySymbol.mockResolvedValue([]);

      const result = await service.getUserAssetDetails(mockUser);

      expect(result[0].name).toBe('RARE');
      expect(result[0].slug).toBe('rare');
    });
  });
});
