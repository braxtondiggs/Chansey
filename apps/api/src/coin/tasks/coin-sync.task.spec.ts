import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import { Job } from 'bullmq';

import { CoinSyncTask } from './coin-sync.task';

import { ExchangeService } from '../../exchange/exchange.service';
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
      relistMany: jest.fn().mockResolvedValue(undefined),
      clearRank: jest.fn()
    };

    exchangeService = {
      getExchanges: jest.fn()
    };

    listingEventService = {
      recordEvent: jest.fn().mockResolvedValue(undefined),
      recordBulkDelistings: jest.fn().mockResolvedValue(undefined),
      recordBulkListings: jest.fn().mockResolvedValue(undefined),
      recordBulkRelistings: jest.fn().mockResolvedValue(undefined)
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

  describe('process', () => {
    it('should route coin-sync jobs to handleSyncCoins', async () => {
      const spy = jest.spyOn(task, 'handleSyncCoins').mockResolvedValue({
        added: 0,
        updated: 0,
        delisted: 0,
        relisted: 0,
        total: 0
      });

      const result = await task.process(mockJob as Job);

      expect(spy).toHaveBeenCalledWith(mockJob);
      expect(result).toEqual(expect.objectContaining({ added: 0 }));
    });

    it('should route coin-detail jobs to handleCoinDetail', async () => {
      mockJob.name = 'coin-detail';
      const spy = jest.spyOn(task, 'handleCoinDetail').mockResolvedValue({
        totalCoins: 5,
        updatedSuccessfully: 5,
        errors: 0
      });

      const result = await task.process(mockJob as Job);

      expect(spy).toHaveBeenCalledWith(mockJob);
      expect(result).toEqual(expect.objectContaining({ totalCoins: 5 }));
    });

    it('should throw for unknown job names', async () => {
      mockJob.name = 'unknown-job';

      await expect(task.process(mockJob as Job)).rejects.toThrow('Unknown job name: unknown-job');
    });
  });

  describe('handleSyncCoins', () => {
    beforeEach(() => {
      // Default mock setup: gecko returns coins, exchange returns tickers with bitcoin + ethereum + newcoin
      geckoClient.coinList.mockResolvedValue(geckoCoins);
      (exchangeService.getExchanges as jest.Mock).mockResolvedValue(supportedExchanges);
      (coinService.getCoins as jest.Mock).mockResolvedValue([...existingCoins]);

      // Mock exchange tickers: page 1 returns bitcoin+ethereum+newcoin tickers, page 2 returns empty
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

    it('should soft-delist coins missing from CoinGecko and record listing events', async () => {
      const result = await task.handleSyncCoins(mockJob as Job);

      // 'oldcoin' is missing from CoinGecko -> should be soft-delisted
      expect(coinService.removeMany).toHaveBeenCalledWith(expect.arrayContaining(['id-old']));
      expect(listingEventService.recordBulkDelistings).toHaveBeenCalledWith(
        expect.arrayContaining(['id-old']),
        'coin_sync'
      );
      expect(result.delisted).toBeGreaterThanOrEqual(1);
    });

    it('should skip delisting when all coins are present in CoinGecko and exchanges', async () => {
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

      const result = await task.handleSyncCoins(mockJob as Job);

      expect(coinService.removeMany).not.toHaveBeenCalled();
      expect(listingEventService.recordBulkDelistings).not.toHaveBeenCalled();
      expect(result.delisted).toBe(0);
    });

    it('should re-list previously delisted coins and record listing events', async () => {
      const delistedCoin = {
        id: 'id-relisted',
        slug: 'relisted-coin',
        symbol: 'rls',
        name: 'RelistedCoin',
        delistedAt: new Date('2026-01-01')
      };

      (coinService.getCoins as jest.Mock).mockResolvedValueOnce([...existingCoins, delistedCoin]);

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

      const result = await task.handleSyncCoins(mockJob as Job);

      expect(coinService.relistMany).toHaveBeenCalledWith(['id-relisted']);
      expect(listingEventService.recordBulkRelistings).toHaveBeenCalledWith(['id-relisted'], 'coin_sync');
      expect(result.relisted).toBe(1);
    });

    it('should soft-delist coins not used in any ticker pairs', async () => {
      // 'oldcoin' IS in CoinGecko but NOT in exchange tickers
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
              { coin_id: 'ethereum', target_coin_id: 'tether' }
            ]
          });
        }
        return Promise.resolve({ tickers: [] });
      });

      await task.handleSyncCoins(mockJob as Job);

      expect(coinService.removeMany).toHaveBeenCalledWith(expect.arrayContaining(['id-old']));
      expect(listingEventService.recordBulkDelistings).toHaveBeenCalledWith(
        expect.arrayContaining(['id-old']),
        'coin_sync'
      );
    });

    it('should add new coins that are in CoinGecko and exchange tickers but not in DB', async () => {
      const result = await task.handleSyncCoins(mockJob as Job);

      // 'newcoin' is in CoinGecko, in exchange tickers, but not in existingCoins
      expect(coinService.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ slug: 'newcoin', symbol: 'new', name: 'NewCoin' })])
      );
      expect(result.added).toBeGreaterThanOrEqual(1);
    });

    it('should return a complete summary with correct keys and numeric values', async () => {
      const result = await task.handleSyncCoins(mockJob as Job);

      expect(result).toEqual(
        expect.objectContaining({
          added: expect.any(Number),
          updated: expect.any(Number),
          delisted: expect.any(Number),
          relisted: expect.any(Number),
          total: expect.any(Number)
        })
      );
      expect(result).not.toHaveProperty('removed');
    });
  });
});
