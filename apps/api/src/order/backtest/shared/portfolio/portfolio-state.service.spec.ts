import { Test, TestingModule } from '@nestjs/testing';

import { DrawdownState, Portfolio, SerializablePortfolio } from './portfolio-state.interface';
import { PortfolioStateService } from './portfolio-state.service';

describe('PortfolioStateService', () => {
  let service: PortfolioStateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PortfolioStateService]
    }).compile();

    service = module.get<PortfolioStateService>(PortfolioStateService);
  });

  describe('initialize', () => {
    it('should create portfolio with initial capital', () => {
      const portfolio = service.initialize(10000);

      expect(portfolio.cashBalance).toBe(10000);
      expect(portfolio.totalValue).toBe(10000);
      expect(portfolio.positions.size).toBe(0);
    });

    it('should handle zero initial capital', () => {
      const portfolio = service.initialize(0);

      expect(portfolio.cashBalance).toBe(0);
      expect(portfolio.totalValue).toBe(0);
    });
  });

  describe('updateValues', () => {
    it('should update position values with current prices', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([
          ['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }],
          ['ethereum', { coinId: 'ethereum', quantity: 1, averagePrice: 2000, totalValue: 2000 }]
        ]),
        totalValue: 11500
      };

      const prices = new Map([
        ['bitcoin', 50000],
        ['ethereum', 2500]
      ]);

      const updated = service.updateValues(portfolio, prices);

      expect(updated.cashBalance).toBe(5000);
      expect(updated.positions.get('bitcoin')?.totalValue).toBe(5000);
      expect(updated.positions.get('ethereum')?.totalValue).toBe(2500);
      expect(updated.totalValue).toBe(12500); // 5000 + 5000 + 2500
    });

    it('should handle missing prices', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }]]),
        totalValue: 9500
      };

      // No price for bitcoin
      const prices = new Map<string, number>();

      const updated = service.updateValues(portfolio, prices);

      // Value should use stored totalValue when no price provided
      expect(updated.totalValue).toBe(9500);
    });

    it('should not mutate original portfolio (immutability)', () => {
      const originalPosition = { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 };
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([['bitcoin', originalPosition]]),
        totalValue: 9500
      };

      const prices = new Map([['bitcoin', 60000]]);
      const updated = service.updateValues(portfolio, prices);

      // Verify original portfolio is unchanged
      expect(portfolio.totalValue).toBe(9500);
      expect(portfolio.cashBalance).toBe(5000);
      expect(portfolio.positions.get('bitcoin')?.totalValue).toBe(4500);
      expect(originalPosition.totalValue).toBe(4500);

      // Verify updated portfolio has new values
      expect(updated.positions.get('bitcoin')?.totalValue).toBe(6000);
      expect(updated.totalValue).toBe(11000);

      // Verify positions maps are different objects
      expect(updated.positions).not.toBe(portfolio.positions);
    });
  });

  describe('applyBuy', () => {
    it('should apply buy trade for new position', () => {
      const portfolio = service.initialize(10000);

      const result = service.applyBuy(portfolio, 'bitcoin', 0.1, 50000, 5);

      expect(result.success).toBe(true);
      expect(result.portfolio.cashBalance).toBe(4995); // 10000 - 5000 - 5
      expect(result.portfolio.positions.get('bitcoin')?.quantity).toBe(0.1);
      expect(result.portfolio.positions.get('bitcoin')?.averagePrice).toBe(50000);
    });

    it('should apply buy trade to increase existing position', () => {
      const portfolio: Portfolio = {
        cashBalance: 10000,
        positions: new Map([['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }]]),
        totalValue: 14500
      };

      const result = service.applyBuy(portfolio, 'bitcoin', 0.1, 55000, 5);

      expect(result.success).toBe(true);
      expect(result.portfolio.positions.get('bitcoin')?.quantity).toBe(0.2);
      // New avg: (45000 * 0.1 + 55000 * 0.1) / 0.2 = 50000
      expect(result.portfolio.positions.get('bitcoin')?.averagePrice).toBe(50000);
    });

    it('should not mutate original portfolio on buy', () => {
      const portfolio: Portfolio = {
        cashBalance: 10000,
        positions: new Map([['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }]]),
        totalValue: 14500
      };

      const result = service.applyBuy(portfolio, 'bitcoin', 0.1, 55000, 5);

      expect(result.success).toBe(true);
      // Verify original portfolio is unchanged
      expect(portfolio.cashBalance).toBe(10000);
      expect(portfolio.positions.get('bitcoin')?.quantity).toBe(0.1);
      expect(portfolio.positions.get('bitcoin')?.averagePrice).toBe(45000);
      expect(portfolio.positions.get('bitcoin')?.totalValue).toBe(4500);
      expect(portfolio.totalValue).toBe(14500);
    });

    it('should reject buy with insufficient funds', () => {
      const portfolio = service.initialize(1000);

      const result = service.applyBuy(portfolio, 'bitcoin', 0.1, 50000, 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient');
      expect(result.portfolio.cashBalance).toBe(1000); // Unchanged
    });

    it('should deduct fee from cash balance', () => {
      const portfolio = service.initialize(10000);

      const result = service.applyBuy(portfolio, 'bitcoin', 0.1, 50000, 50);

      // Cost: 0.1 * 50000 = 5000, Fee: 50
      expect(result.portfolio.cashBalance).toBe(4950);
    });
  });

  describe('applySell', () => {
    it('should apply sell trade and close position', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }]]),
        totalValue: 9500
      };

      const result = service.applySell(portfolio, 'bitcoin', 0.1, 55000, 5);

      expect(result.success).toBe(true);
      // Proceeds: 0.1 * 55000 = 5500, less fee 5 = 5495 added to cash
      expect(result.portfolio.cashBalance).toBe(10495);
      expect(result.portfolio.positions.has('bitcoin')).toBe(false);
    });

    it('should apply partial sell and reduce position', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([['bitcoin', { coinId: 'bitcoin', quantity: 1, averagePrice: 45000, totalValue: 45000 }]]),
        totalValue: 50000
      };

      const result = service.applySell(portfolio, 'bitcoin', 0.5, 55000, 5);

      expect(result.success).toBe(true);
      expect(result.portfolio.positions.get('bitcoin')?.quantity).toBe(0.5);
      expect(result.portfolio.positions.get('bitcoin')?.averagePrice).toBe(45000); // Unchanged
      // Remaining position valued at sell price
      expect(result.portfolio.positions.get('bitcoin')?.totalValue).toBe(27500);
    });

    it('should reject sell with no position', () => {
      const portfolio = service.initialize(10000);

      const result = service.applySell(portfolio, 'bitcoin', 0.1, 55000, 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No position');
    });

    it('should cap sell quantity to available', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }]]),
        totalValue: 9500
      };

      // Try to sell more than we have
      const result = service.applySell(portfolio, 'bitcoin', 1, 55000, 5);

      expect(result.success).toBe(true);
      // Should sell only 0.1 (what we have)
      expect(result.portfolio.positions.has('bitcoin')).toBe(false);
      expect(result.portfolio.cashBalance).toBe(10495); // 5000 + 5500 - 5
    });

    it('should not mutate original portfolio on sell', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([['bitcoin', { coinId: 'bitcoin', quantity: 1, averagePrice: 45000, totalValue: 45000 }]]),
        totalValue: 50000
      };

      const result = service.applySell(portfolio, 'bitcoin', 0.25, 55000, 5);

      expect(result.success).toBe(true);
      expect(portfolio.cashBalance).toBe(5000);
      expect(portfolio.positions.get('bitcoin')?.quantity).toBe(1);
    });
  });

  describe('createSnapshot', () => {
    it('should create snapshot with all fields', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([
          ['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 5500 }],
          ['ethereum', { coinId: 'ethereum', quantity: 1, averagePrice: 2000, totalValue: 2500 }]
        ]),
        totalValue: 13000
      };

      const prices = new Map([
        ['bitcoin', 55000],
        ['ethereum', 2500]
      ]);

      const drawdownState: DrawdownState = {
        peakValue: 15000,
        maxDrawdown: 0.2,
        currentDrawdown: 0.1333
      };

      const snapshot = service.createSnapshot(portfolio, new Date('2024-01-15'), prices, 10000, drawdownState);

      expect(snapshot.portfolioValue).toBe(13000);
      expect(snapshot.cashBalance).toBe(5000);
      expect(snapshot.cumulativeReturn).toBe(0.3); // (13000-10000)/10000
      expect(snapshot.drawdown).toBeCloseTo(0.1333, 3);
      expect(snapshot.holdings['bitcoin'].quantity).toBe(0.1);
      expect(snapshot.holdings['bitcoin'].price).toBe(55000);
      expect(snapshot.holdings['ethereum'].value).toBe(2500);
    });

    it('should handle zero initial capital', () => {
      const portfolio = service.initialize(0);
      const drawdownState: DrawdownState = { peakValue: 0, maxDrawdown: 0, currentDrawdown: 0 };

      const snapshot = service.createSnapshot(portfolio, new Date(), new Map(), 0, drawdownState);

      expect(snapshot.cumulativeReturn).toBe(0);
    });

    it('should set holding price to 0 when missing from price map', () => {
      const portfolio: Portfolio = {
        cashBalance: 0,
        positions: new Map([['bitcoin', { coinId: 'bitcoin', quantity: 1, averagePrice: 30000, totalValue: 30000 }]]),
        totalValue: 30000
      };
      const drawdownState: DrawdownState = { peakValue: 30000, maxDrawdown: 0, currentDrawdown: 0 };

      const snapshot = service.createSnapshot(portfolio, new Date('2024-01-01'), new Map(), 10000, drawdownState);

      expect(snapshot.holdings['bitcoin'].price).toBe(0);
      expect(snapshot.holdings['bitcoin'].value).toBe(0);
    });
  });

  describe('updateDrawdown', () => {
    it('should update peak on new high', () => {
      const state: DrawdownState = {
        peakValue: 10000,
        maxDrawdown: 0.1,
        currentDrawdown: 0
      };

      const updated = service.updateDrawdown(12000, state);

      expect(updated.peakValue).toBe(12000);
      expect(updated.currentDrawdown).toBe(0);
    });

    it('should calculate current drawdown', () => {
      const state: DrawdownState = {
        peakValue: 10000,
        maxDrawdown: 0.1,
        currentDrawdown: 0
      };

      const updated = service.updateDrawdown(8000, state);

      expect(updated.peakValue).toBe(10000); // Unchanged
      expect(updated.currentDrawdown).toBe(0.2); // (10000-8000)/10000
    });

    it('should update max drawdown if larger', () => {
      const state: DrawdownState = {
        peakValue: 10000,
        maxDrawdown: 0.1,
        currentDrawdown: 0.05
      };

      const updated = service.updateDrawdown(7000, state);

      expect(updated.maxDrawdown).toBe(0.3); // (10000-7000)/10000
    });

    it('should not reduce max drawdown', () => {
      const state: DrawdownState = {
        peakValue: 10000,
        maxDrawdown: 0.3,
        currentDrawdown: 0.2
      };

      const updated = service.updateDrawdown(9500, state);

      expect(updated.maxDrawdown).toBe(0.3); // Unchanged
      expect(updated.currentDrawdown).toBe(0.05);
    });

    it('should handle zero peak value', () => {
      const state: DrawdownState = {
        peakValue: 0,
        maxDrawdown: 0,
        currentDrawdown: 0
      };

      const updated = service.updateDrawdown(0, state);

      expect(updated.currentDrawdown).toBe(0);
    });
  });

  describe('calculatePositionsValue', () => {
    it('should calculate total positions value', () => {
      const positions = new Map([
        ['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }],
        ['ethereum', { coinId: 'ethereum', quantity: 2, averagePrice: 2000, totalValue: 4000 }]
      ]);

      const prices = new Map([
        ['bitcoin', 50000],
        ['ethereum', 2500]
      ]);

      const value = service.calculatePositionsValue(positions, prices);

      expect(value).toBe(10000); // 0.1*50000 + 2*2500
    });

    it('should use stored value when price not available', () => {
      const positions = new Map([
        ['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }]
      ]);

      const value = service.calculatePositionsValue(positions, new Map());

      expect(value).toBe(4500); // Falls back to totalValue
    });

    it('should combine priced and unpriced positions', () => {
      const positions = new Map([
        ['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }],
        ['ethereum', { coinId: 'ethereum', quantity: 2, averagePrice: 2000, totalValue: 4000 }]
      ]);

      const prices = new Map([['ethereum', 2500]]);

      const value = service.calculatePositionsValue(positions, prices);

      // bitcoin uses stored totalValue (4500), ethereum uses price (2*2500=5000)
      expect(value).toBe(9500);
    });
  });

  describe('serialize/deserialize', () => {
    it('should serialize portfolio', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([
          ['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }],
          ['ethereum', { coinId: 'ethereum', quantity: 1, averagePrice: 2000, totalValue: 2000 }]
        ]),
        totalValue: 11500
      };

      const serialized = service.serialize(portfolio);

      expect(serialized.cashBalance).toBe(5000);
      expect(serialized.positions).toHaveLength(2);
      expect(serialized.positions.find((p) => p.coinId === 'bitcoin')?.quantity).toBe(0.1);
    });

    it('should deserialize portfolio', () => {
      const serialized: SerializablePortfolio = {
        cashBalance: 5000,
        positions: [
          { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000 },
          { coinId: 'ethereum', quantity: 1, averagePrice: 2000 }
        ]
      };

      const prices = new Map([
        ['bitcoin', 50000],
        ['ethereum', 2500]
      ]);

      const portfolio = service.deserialize(serialized, prices);

      expect(portfolio.cashBalance).toBe(5000);
      expect(portfolio.positions.size).toBe(2);
      expect(portfolio.positions.get('bitcoin')?.quantity).toBe(0.1);
      expect(portfolio.positions.get('bitcoin')?.totalValue).toBe(5000);
      expect(portfolio.totalValue).toBe(12500); // 5000 + 5000 + 2500
    });

    it('should deserialize without current prices using average price', () => {
      const serialized: SerializablePortfolio = {
        cashBalance: 5000,
        positions: [{ coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000 }]
      };

      const portfolio = service.deserialize(serialized);

      expect(portfolio.positions.get('bitcoin')?.totalValue).toBe(4500);
      expect(portfolio.totalValue).toBe(9500);
    });

    it('should prefer current prices when provided', () => {
      const serialized: SerializablePortfolio = {
        cashBalance: 1000,
        positions: [{ coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000 }]
      };

      const portfolio = service.deserialize(serialized, new Map([['bitcoin', 50000]]));

      expect(portfolio.positions.get('bitcoin')?.totalValue).toBe(5000);
      expect(portfolio.totalValue).toBe(6000);
    });

    it('should round-trip serialize/deserialize', () => {
      const original: Portfolio = {
        cashBalance: 5000,
        positions: new Map([['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }]]),
        totalValue: 9500
      };

      const serialized = service.serialize(original);
      const restored = service.deserialize(serialized);

      expect(restored.cashBalance).toBe(original.cashBalance);
      expect(restored.positions.get('bitcoin')?.quantity).toBe(original.positions.get('bitcoin')?.quantity);
      expect(restored.positions.get('bitcoin')?.averagePrice).toBe(original.positions.get('bitcoin')?.averagePrice);
    });
  });
});
