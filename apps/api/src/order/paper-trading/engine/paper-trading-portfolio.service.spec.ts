import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PaperTradingPortfolioService } from './paper-trading-portfolio.service';

import { PaperTradingAccount } from '../entities';

describe('PaperTradingPortfolioService', () => {
  let service: PaperTradingPortfolioService;
  let repo: { find: jest.Mock };

  const mkAccount = (overrides: Partial<PaperTradingAccount>): PaperTradingAccount =>
    ({
      currency: 'USD',
      available: 0,
      total: 0,
      averageCost: 0,
      ...overrides
    }) as PaperTradingAccount;

  beforeEach(async () => {
    repo = { find: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaperTradingPortfolioService, { provide: getRepositoryToken(PaperTradingAccount), useValue: repo }]
    }).compile();
    service = module.get(PaperTradingPortfolioService);
  });

  describe('buildFromAccounts', () => {
    it('builds portfolio with cash and positions', () => {
      const accounts = [
        mkAccount({ currency: 'USD', available: 1000, total: 1000 }),
        mkAccount({ currency: 'BTC', total: 0.5, averageCost: 50000 })
      ];
      const portfolio = service.buildFromAccounts(accounts, 'USD');
      expect(portfolio.cashBalance).toBe(1000);
      expect(portfolio.positions.size).toBe(1);
      expect(portfolio.positions.get('BTC')?.quantity).toBe(0.5);
      expect(portfolio.positions.get('BTC')?.averagePrice).toBe(50000);
    });

    it('skips zero-balance positions', () => {
      const accounts = [
        mkAccount({ currency: 'USD', available: 100, total: 100 }),
        mkAccount({ currency: 'BTC', total: 0 })
      ];
      const portfolio = service.buildFromAccounts(accounts, 'USD');
      expect(portfolio.positions.size).toBe(0);
    });
  });

  describe('updateWithPrices', () => {
    it('mutates portfolio totals from prices', () => {
      const accounts = [
        mkAccount({ currency: 'USD', available: 1000, total: 1000 }),
        mkAccount({ currency: 'BTC', total: 0.5, averageCost: 50000 })
      ];
      const portfolio = service.buildFromAccounts(accounts, 'USD');
      const result = service.updateWithPrices(portfolio, { 'BTC/USD': 60000 }, 'USD');
      expect(result.positions.get('BTC')?.totalValue).toBe(30000);
      expect(result.totalValue).toBe(31000);
    });

    it('treats missing prices as 0', () => {
      const accounts = [
        mkAccount({ currency: 'USD', available: 500, total: 500 }),
        mkAccount({ currency: 'BTC', total: 1 })
      ];
      const portfolio = service.buildFromAccounts(accounts, 'USD');
      const result = service.updateWithPrices(portfolio, {}, 'USD');
      expect(result.totalValue).toBe(500);
    });
  });

  describe('calculateValue', () => {
    it('sums cash and priced positions without mutating portfolio', () => {
      const accounts = [
        mkAccount({ currency: 'USD', available: 200, total: 200 }),
        mkAccount({ currency: 'ETH', total: 2 })
      ];
      const portfolio = service.buildFromAccounts(accounts, 'USD');
      const value = service.calculateValue(portfolio, { 'ETH/USD': 2000 }, 'USD');
      expect(value).toBe(4200);
      expect(portfolio.positions.get('ETH')?.totalValue).toBe(0);
    });
  });

  describe('buildPositionsContext', () => {
    it('returns plain map of currency → quantity', () => {
      const accounts = [
        mkAccount({ currency: 'USD', total: 1000 }),
        mkAccount({ currency: 'BTC', total: 0.1 }),
        mkAccount({ currency: 'ETH', total: 0 })
      ];
      expect(service.buildPositionsContext(accounts, 'USD')).toEqual({ BTC: 0.1 });
    });
  });

  describe('refresh', () => {
    it('loads accounts and reprices portfolio', async () => {
      repo.find.mockResolvedValueOnce([
        mkAccount({ currency: 'USD', available: 500, total: 500 }),
        mkAccount({ currency: 'BTC', total: 0.2, averageCost: 40000 })
      ]);
      const { accounts, portfolio } = await service.refresh('session-1', { 'BTC/USD': 50000 }, 'USD');
      expect(repo.find).toHaveBeenCalledWith({ where: { session: { id: 'session-1' } } });
      expect(accounts).toHaveLength(2);
      expect(portfolio.totalValue).toBe(10500);
    });
  });
});
