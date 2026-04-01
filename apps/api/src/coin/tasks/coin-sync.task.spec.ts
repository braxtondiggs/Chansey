import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import { Job } from 'bullmq';

import { CoinSyncTask } from './coin-sync.task';

import { ExchangeService } from '../../exchange/exchange.service';
import { CoinListingEventType } from '../coin-listing-event.entity';
import { CoinListingEventService } from '../coin-listing-event.service';
import { CoinService } from '../coin.service';

// Mock coingecko-api-v3 module
jest.mock('coingecko-api-v3', () => ({
  CoinGeckoClient: jest.fn().mockImplementation(() => ({
    coinList: jest.fn(),
    exchangeIdTickers: jest.fn(),
    coinId: jest.fn(),
    trending: jest.fn()
  }))
}));

describe('CoinSyncTask', () => {
  let task: CoinSyncTask;
  let coinService: jest.Mocked<Partial<CoinService>>;
  let exchangeService: jest.Mocked<Partial<ExchangeService>>;
  let listingEventService: jest.Mocked<Partial<CoinListingEventService>>;
  let mockQueue: Record<string, jest.Mock>;
  let mockJob: Partial<Job>;

  // Access the mocked gecko client on the task instance
  let geckoClient: Record<string, jest.Mock>;

  const existingCoins = [
    { id: 'id-btc', slug: 'bitcoin', symbol: 'btc', name: 'Bitcoin', delistedAt: null },
    { id: 'id-eth', slug: 'ethereum', symbol: 'eth', name: 'Ethereum', delistedAt: null },
    { id: 'id-old', slug: 'oldcoin', symbol: 'old', name: 'OldCoin', delistedAt: null }
  ];

  const geckoCoins = [
    { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
    { id: 'ethereum', symbol: 'eth', name: 'Ethereum' },
    { id: 'newcoin', symbol: 'new', name: 'NewCoin' }
    // 'oldcoin' is missing from CoinGecko -> should be delisted
  ];

  const supportedExchanges = [{ slug: 'binance', name: 'Binance' }];

  beforeEach(async () => {
    coinService = {
      getCoins: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      removeMany: jest.fn(),
      relistCoin: jest.fn(),
      clearRank: jest.fn()
    };

    exchangeService = {
      getExchanges: jest.fn()
    };

    listingEventService = {
      recordEvent: jest.fn().mockResolvedValue(undefined),
      recordBulkDelistings: jest.fn().mockResolvedValue(undefined)
    };

    mockQueue = {
      add: jest.fn(),
      getRepeatableJobs: jest.fn().mockResolvedValue([])
    };

    mockJob = {
      id: 'test-job-1',
      name: 'coin-sync',
      updateProgress: jest.fn().mockResolvedValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoinSyncTask,
        { provide: CoinService, useValue: coinService },
        { provide: ExchangeService, useValue: exchangeService },
        { provide: CoinListingEventService, useValue: listingEventService },
        { provide: getQueueToken('coin-queue'), useValue: mockQueue }
      ]
    }).compile();

    task = module.get<CoinSyncTask>(CoinSyncTask);

    // Access the private gecko instance
    geckoClient = (task as unknown as { gecko: Record<string, jest.Mock> }).gecko;
  });

  describe('handleSyncCoins', () => {
    beforeEach(() => {
      // Default mock setup: gecko returns coins, exchange returns tickers with bitcoin + ethereum
      geckoClient.coinList.mockResolvedValue(geckoCoins);
      (exchangeService.getExchanges as jest.Mock).mockResolvedValue(supportedExchanges);
      (coinService.getCoins as jest.Mock).mockResolvedValue([...existingCoins]);

      // Mock exchange tickers: page 1 returns bitcoin+ethereum tickers, page 2 returns empty
      geckoClient.exchangeIdTickers.mockImplementation(({ page }: { page: number }) => {
        if (page === 1) {
          return Promise.resolve({
            tickers: [
              { coin_id: 'bitcoin', target_coin_id: 'tether' },
              { coin_id: 'ethereum', target_coin_id: 'tether' },
              { coin_id: 'newcoin', target_coin_id: 'tether' }
            ]
          });
        }
        return Promise.resolve({ tickers: [] });
      });

      (coinService.createMany as jest.Mock).mockResolvedValue([]);
    });

    it('should call removeMany for coins to delist', async () => {
      const result = await task.handleSyncCoins(mockJob as Job);

      // 'oldcoin' is missing from CoinGecko -> should be soft-delisted
      expect(coinService.removeMany).toHaveBeenCalledWith(expect.arrayContaining(['id-old']));
      expect(result).toHaveProperty('delisted');
    });

    it('should call recordBulkDelistings after soft-deleting coins', async () => {
      await task.handleSyncCoins(mockJob as Job);

      expect(listingEventService.recordBulkDelistings).toHaveBeenCalledWith(
        expect.arrayContaining(['id-old']),
        'coin_sync'
      );
    });

    it('should not call recordBulkDelistings when no coins are delisted', async () => {
      // All existing coins are in CoinGecko and on exchanges
      geckoClient.coinList.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
        { id: 'ethereum', symbol: 'eth', name: 'Ethereum' },
        { id: 'oldcoin', symbol: 'old', name: 'OldCoin' }
      ]);

      geckoClient.exchangeIdTickers.mockImplementation(({ page }: { page: number }) => {
        if (page === 1) {
          return Promise.resolve({
            tickers: [
              { coin_id: 'bitcoin', target_coin_id: 'tether' },
              { coin_id: 'ethereum', target_coin_id: 'tether' },
              { coin_id: 'oldcoin', target_coin_id: 'tether' }
            ]
          });
        }
        return Promise.resolve({ tickers: [] });
      });

      await task.handleSyncCoins(mockJob as Job);

      expect(coinService.removeMany).not.toHaveBeenCalled();
      expect(listingEventService.recordBulkDelistings).not.toHaveBeenCalled();
    });

    it('should detect previously-delisted coins that reappear and call relistCoin', async () => {
      // After the main sync, getCoins({ includeDelisted: true }) returns a delisted coin
      // that is back in CoinGecko and used on exchanges
      const delistedCoin = {
        id: 'id-relisted',
        slug: 'relisted-coin',
        symbol: 'rls',
        name: 'RelistedCoin',
        delistedAt: new Date('2026-01-01')
      };

      // First call: normal getCoins (no delisted), second call: includeDelisted
      (coinService.getCoins as jest.Mock)
        .mockResolvedValueOnce([...existingCoins]) // initial fetch
        .mockResolvedValueOnce([...existingCoins, delistedCoin]); // includeDelisted

      // Add relisted-coin to CoinGecko response
      geckoClient.coinList.mockResolvedValue([
        ...geckoCoins,
        { id: 'relisted-coin', symbol: 'rls', name: 'RelistedCoin' }
      ]);

      // Add relisted-coin to exchange tickers
      geckoClient.exchangeIdTickers.mockImplementation(({ page }: { page: number }) => {
        if (page === 1) {
          return Promise.resolve({
            tickers: [
              { coin_id: 'bitcoin', target_coin_id: 'tether' },
              { coin_id: 'ethereum', target_coin_id: 'tether' },
              { coin_id: 'newcoin', target_coin_id: 'tether' },
              { coin_id: 'relisted-coin', target_coin_id: 'tether' }
            ]
          });
        }
        return Promise.resolve({ tickers: [] });
      });

      const result = await task.handleSyncCoins(mockJob as Job);

      expect(coinService.relistCoin).toHaveBeenCalledWith('id-relisted');
      expect(result).toHaveProperty('relisted', 1);
    });

    it('should record LISTED events for re-listed coins', async () => {
      const delistedCoin = {
        id: 'id-relisted',
        slug: 'relisted-coin',
        symbol: 'rls',
        name: 'RelistedCoin',
        delistedAt: new Date('2026-01-01')
      };

      (coinService.getCoins as jest.Mock)
        .mockResolvedValueOnce([...existingCoins])
        .mockResolvedValueOnce([...existingCoins, delistedCoin]);

      geckoClient.coinList.mockResolvedValue([
        ...geckoCoins,
        { id: 'relisted-coin', symbol: 'rls', name: 'RelistedCoin' }
      ]);

      geckoClient.exchangeIdTickers.mockImplementation(({ page }: { page: number }) => {
        if (page === 1) {
          return Promise.resolve({
            tickers: [
              { coin_id: 'bitcoin', target_coin_id: 'tether' },
              { coin_id: 'ethereum', target_coin_id: 'tether' },
              { coin_id: 'newcoin', target_coin_id: 'tether' },
              { coin_id: 'relisted-coin', target_coin_id: 'tether' }
            ]
          });
        }
        return Promise.resolve({ tickers: [] });
      });

      await task.handleSyncCoins(mockJob as Job);

      expect(listingEventService.recordEvent).toHaveBeenCalledWith('id-relisted', CoinListingEventType.LISTED, {
        source: 'coin_sync'
      });
    });

    it('should return summary with delisted key instead of removed', async () => {
      const result = await task.handleSyncCoins(mockJob as Job);

      expect(result).toHaveProperty('delisted');
      expect(result).toHaveProperty('relisted');
      expect(result).not.toHaveProperty('removed');
      expect(result).toHaveProperty('added');
      expect(result).toHaveProperty('updated');
      expect(result).toHaveProperty('total');
    });

    it('should soft-delist coins not used in any ticker pairs', async () => {
      // 'oldcoin' IS in CoinGecko but NOT in exchange tickers
      geckoClient.coinList.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
        { id: 'ethereum', symbol: 'eth', name: 'Ethereum' },
        { id: 'oldcoin', symbol: 'old', name: 'OldCoin' }
      ]);

      // Exchange tickers only have bitcoin and ethereum
      geckoClient.exchangeIdTickers.mockImplementation(({ page }: { page: number }) => {
        if (page === 1) {
          return Promise.resolve({
            tickers: [
              { coin_id: 'bitcoin', target_coin_id: 'tether' },
              { coin_id: 'ethereum', target_coin_id: 'tether' }
            ]
          });
        }
        return Promise.resolve({ tickers: [] });
      });

      await task.handleSyncCoins(mockJob as Job);

      // oldcoin should be delisted because it's not used in ticker pairs
      expect(coinService.removeMany).toHaveBeenCalledWith(expect.arrayContaining(['id-old']));
      expect(listingEventService.recordBulkDelistings).toHaveBeenCalledWith(
        expect.arrayContaining(['id-old']),
        'coin_sync'
      );
    });
  });
});
