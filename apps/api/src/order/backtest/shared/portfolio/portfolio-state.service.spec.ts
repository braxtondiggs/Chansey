import { Test, type TestingModule } from '@nestjs/testing';

import { type DrawdownState, type Portfolio, type SerializablePortfolio } from './portfolio-state.interface';
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

    it('should round-trip entryDate through serialize/deserialize', () => {
      const entryDate = new Date('2024-06-15T10:30:00.000Z');
      const original: Portfolio = {
        cashBalance: 5000,
        positions: new Map([
          ['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500, entryDate }]
        ]),
        totalValue: 9500
      };

      const serialized = service.serialize(original);

      expect(serialized.positions[0].entryDate).toBe('2024-06-15T10:30:00.000Z');

      const restored = service.deserialize(serialized);
      const restoredPos = restored.positions.get('bitcoin');

      expect(restoredPos?.entryDate).toBeInstanceOf(Date);
      expect(restoredPos?.entryDate?.toISOString()).toBe('2024-06-15T10:30:00.000Z');
    });

    it('should deserialize legacy checkpoint without entryDate', () => {
      const serialized: SerializablePortfolio = {
        cashBalance: 5000,
        positions: [{ coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000 }]
      };

      const restored = service.deserialize(serialized);

      expect(restored.positions.get('bitcoin')?.entryDate).toBeUndefined();
    });
  });

  /* ================================================================
   * SHORT / LEVERAGE / FUTURES TESTS
   * ================================================================ */

  describe('applyOpenShort', () => {
    describe('basic short opening', () => {
      it('should deduct margin + fee from cash', () => {
        const portfolio = service.initialize(10000);

        // quantity=0.1, price=50000, leverage=5 => margin = (0.1*50000)/5 = 1000
        const result = service.applyOpenShort(portfolio, 'bitcoin', 0.1, 50000, 10, 5);

        expect(result.success).toBe(true);
        // cash = 10000 - 1000 (margin) - 10 (fee) = 8990
        expect(result.portfolio.cashBalance).toBeCloseTo(8990, 2);
      });

      it('should create position with correct short fields', () => {
        const portfolio = service.initialize(10000);
        const result = service.applyOpenShort(portfolio, 'bitcoin', 0.1, 50000, 10, 5);

        expect(result.success).toBe(true);
        const pos = result.portfolio.positions.get('bitcoin');
        expect(pos).toBeDefined();
        expect(pos?.side).toBe('short');
        expect(pos?.leverage).toBe(5);
        expect(pos?.quantity).toBe(0.1);
        expect(pos?.averagePrice).toBe(50000);
        // marginAmount = (0.1 * 50000) / 5 = 1000
        expect(pos?.marginAmount).toBe(1000);
        expect(pos?.totalValue).toBe(1000);
      });

      it('should calculate liquidation price correctly', () => {
        const portfolio = service.initialize(10000);
        const result = service.applyOpenShort(portfolio, 'bitcoin', 0.1, 50000, 0, 5);

        expect(result.success).toBe(true);
        const pos = result.portfolio.positions.get('bitcoin');
        // liquidationPrice = 50000 * (1 + 1/5 - 0.005) = 50000 * 1.195 = 59750
        expect(pos?.liquidationPrice).toBeCloseTo(59750, 2);
      });

      it('should update totalMarginUsed', () => {
        const portfolio = service.initialize(10000);
        const result = service.applyOpenShort(portfolio, 'bitcoin', 0.1, 50000, 0, 5);

        expect(result.success).toBe(true);
        // margin = (0.1 * 50000) / 5 = 1000
        expect(result.portfolio.totalMarginUsed).toBe(1000);
      });

      it('should set availableMargin to newCashBalance', () => {
        const portfolio = service.initialize(10000);
        const result = service.applyOpenShort(portfolio, 'bitcoin', 0.1, 50000, 10, 5);

        expect(result.success).toBe(true);
        expect(result.portfolio.availableMargin).toBeCloseTo(8990, 2);
      });
    });

    describe('leverage variations', () => {
      it('should handle 1x leverage (no leverage)', () => {
        const portfolio = service.initialize(100000);

        // margin = (0.1 * 50000) / 1 = 5000
        const result = service.applyOpenShort(portfolio, 'bitcoin', 0.1, 50000, 0, 1);

        expect(result.success).toBe(true);
        expect(result.portfolio.positions.get('bitcoin')?.marginAmount).toBe(5000);
        expect(result.portfolio.cashBalance).toBe(95000);
      });

      it('should handle 10x leverage', () => {
        const portfolio = service.initialize(10000);

        // margin = (0.1 * 50000) / 10 = 500
        const result = service.applyOpenShort(portfolio, 'bitcoin', 0.1, 50000, 0, 10);

        expect(result.success).toBe(true);
        expect(result.portfolio.positions.get('bitcoin')?.marginAmount).toBe(500);
        expect(result.portfolio.cashBalance).toBe(9500);
      });
    });

    describe('insufficient funds', () => {
      it('should reject when cash < margin + fee', () => {
        const portfolio = service.initialize(500);

        // margin = (0.1 * 50000) / 5 = 1000, fee = 10 => need 1010
        const result = service.applyOpenShort(portfolio, 'bitcoin', 0.1, 50000, 10, 5);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Insufficient');
        expect(result.portfolio.cashBalance).toBe(500); // Unchanged
      });
    });

    describe('conflict with existing long', () => {
      it('should reject when long position exists for same coin', () => {
        const portfolio: Portfolio = {
          cashBalance: 10000,
          positions: new Map([
            ['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 50000, totalValue: 5000 }]
          ]),
          totalValue: 15000
        };

        const result = service.applyOpenShort(portfolio, 'bitcoin', 0.1, 50000, 0, 5);

        expect(result.success).toBe(false);
        expect(result.error).toContain('long position already exists');
      });
    });

    describe('immutability', () => {
      it('should not mutate original portfolio', () => {
        const portfolio = service.initialize(10000);
        const result = service.applyOpenShort(portfolio, 'bitcoin', 0.1, 50000, 10, 5);

        expect(result.success).toBe(true);
        expect(portfolio.cashBalance).toBe(10000);
        expect(portfolio.positions.size).toBe(0);
      });
    });
  });

  describe('applyCloseShort', () => {
    // Helper to create a portfolio with a short position
    function createPortfolioWithShort(
      cash: number,
      coinId: string,
      quantity: number,
      entryPrice: number,
      leverage: number
    ): Portfolio {
      const marginAmount = (quantity * entryPrice) / leverage;
      const liquidationPrice = entryPrice * (1 + 1 / leverage - 0.005);
      return {
        cashBalance: cash,
        positions: new Map([
          [
            coinId,
            {
              coinId,
              quantity,
              averagePrice: entryPrice,
              totalValue: marginAmount,
              side: 'short' as const,
              leverage,
              marginAmount,
              liquidationPrice
            }
          ]
        ]),
        totalValue: cash + marginAmount,
        totalMarginUsed: marginAmount,
        availableMargin: cash
      };
    }

    describe('profit scenario (price dropped)', () => {
      it('should increase cash by margin + profit - fee', () => {
        const portfolio = createPortfolioWithShort(5000, 'bitcoin', 1, 50000, 5);
        // margin = (1 * 50000) / 5 = 10000
        // Cash is 5000, margin is 10000

        const result = service.applyCloseShort(portfolio, 'bitcoin', 1, 45000, 10);

        expect(result.success).toBe(true);
        // P&L = (50000 - 45000) * 1 = 5000
        // returnedMargin = 10000
        // newCash = 5000 + 10000 + 5000 - 10 = 19990
        expect(result.portfolio.cashBalance).toBeCloseTo(19990, 2);
      });

      it('should remove position on full close', () => {
        const portfolio = createPortfolioWithShort(5000, 'bitcoin', 1, 50000, 5);

        const result = service.applyCloseShort(portfolio, 'bitcoin', 1, 45000, 0);

        expect(result.success).toBe(true);
        expect(result.portfolio.positions.has('bitcoin')).toBe(false);
      });
    });

    describe('loss scenario (price rose)', () => {
      it('should increase cash by margin - loss - fee', () => {
        const portfolio = createPortfolioWithShort(5000, 'bitcoin', 1, 50000, 5);
        // margin = 10000

        const result = service.applyCloseShort(portfolio, 'bitcoin', 1, 55000, 10);

        expect(result.success).toBe(true);
        // P&L = (50000 - 55000) * 1 = -5000
        // returnedMargin = 10000
        // newCash = 5000 + 10000 + (-5000) - 10 = 9990
        expect(result.portfolio.cashBalance).toBeCloseTo(9990, 2);
      });
    });

    describe('loss capped at margin', () => {
      it('should cap loss when underwater (loss exceeds margin)', () => {
        // 10x leverage, margin = 5000
        const portfolio = createPortfolioWithShort(5000, 'bitcoin', 1, 50000, 10);

        // Price rose to 60000 => raw P&L = (50000 - 60000) * 1 = -10000
        // But margin is only 5000, so capped at -5000
        const result = service.applyCloseShort(portfolio, 'bitcoin', 1, 60000, 0);

        expect(result.success).toBe(true);
        // newCash = 5000 + 5000 (margin) + (-5000) (capped) - 0 (fee) = 5000
        expect(result.portfolio.cashBalance).toBeCloseTo(5000, 2);
        expect(result.portfolio.positions.has('bitcoin')).toBe(false);
      });
    });

    describe('partial close', () => {
      it('should reduce position quantity and margin proportionally', () => {
        const portfolio = createPortfolioWithShort(5000, 'bitcoin', 1, 50000, 5);
        // margin = 10000

        const result = service.applyCloseShort(portfolio, 'bitcoin', 0.5, 48000, 0);

        expect(result.success).toBe(true);
        const pos = result.portfolio.positions.get('bitcoin');
        expect(pos).toBeDefined();
        expect(pos?.quantity).toBe(0.5);
        // Remaining margin = 10000 * (0.5 / 1) = 5000
        expect(pos?.marginAmount).toBeCloseTo(5000, 2);
        expect(pos?.side).toBe('short');
        expect(pos?.leverage).toBe(5);
      });

      it('should add proportional margin + P&L to cash on partial close', () => {
        const portfolio = createPortfolioWithShort(5000, 'bitcoin', 1, 50000, 5);
        // margin = 10000

        // Close half at 48000 (profit)
        const result = service.applyCloseShort(portfolio, 'bitcoin', 0.5, 48000, 0);

        expect(result.success).toBe(true);
        // returnedMargin = 10000 * 0.5 = 5000
        // P&L = (50000 - 48000) * 0.5 = 1000
        // newCash = 5000 + 5000 + 1000 - 0 = 11000
        expect(result.portfolio.cashBalance).toBeCloseTo(11000, 2);
      });
    });

    describe('totalMarginUsed tracking', () => {
      it('should decrement totalMarginUsed on close', () => {
        const portfolio = createPortfolioWithShort(5000, 'bitcoin', 1, 50000, 5);
        // margin = 10000, so totalMarginUsed = 10000

        const result = service.applyCloseShort(portfolio, 'bitcoin', 0.5, 48000, 0);

        expect(result.success).toBe(true);
        // Returned margin = 5000
        // newTotalMarginUsed = max(0, 10000 - 5000) = 5000
        expect(result.portfolio.totalMarginUsed).toBeCloseTo(5000, 2);
      });

      it('should set totalMarginUsed to 0 on full close', () => {
        const portfolio = createPortfolioWithShort(5000, 'bitcoin', 1, 50000, 5);

        const result = service.applyCloseShort(portfolio, 'bitcoin', 1, 48000, 0);

        expect(result.success).toBe(true);
        expect(result.portfolio.totalMarginUsed).toBe(0);
      });
    });

    describe('validation', () => {
      it('should reject when no short position exists', () => {
        const portfolio = service.initialize(10000);

        const result = service.applyCloseShort(portfolio, 'bitcoin', 0.1, 50000, 0);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No short position');
      });

      it('should reject when position is long, not short', () => {
        const portfolio: Portfolio = {
          cashBalance: 10000,
          positions: new Map([
            ['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 50000, totalValue: 5000 }]
          ]),
          totalValue: 15000
        };

        const result = service.applyCloseShort(portfolio, 'bitcoin', 0.1, 50000, 0);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No short position');
      });

      it('should cap quantity to available when trying to close more than held', () => {
        const portfolio = createPortfolioWithShort(5000, 'bitcoin', 0.5, 50000, 5);

        const result = service.applyCloseShort(portfolio, 'bitcoin', 10, 48000, 0);

        expect(result.success).toBe(true);
        expect(result.portfolio.positions.has('bitcoin')).toBe(false);
      });
    });

    describe('immutability', () => {
      it('should not mutate original portfolio on close', () => {
        const portfolio = createPortfolioWithShort(5000, 'bitcoin', 1, 50000, 5);

        const result = service.applyCloseShort(portfolio, 'bitcoin', 0.5, 48000, 0);

        expect(result.success).toBe(true);
        expect(portfolio.cashBalance).toBe(5000);
        expect(portfolio.positions.get('bitcoin')?.quantity).toBe(1);
      });
    });
  });

  describe('updateValues with short positions', () => {
    it('should update short position value using margin + unrealized P&L formula', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([
          [
            'bitcoin',
            {
              coinId: 'bitcoin',
              quantity: 1,
              averagePrice: 50000,
              totalValue: 10000,
              side: 'short' as const,
              leverage: 5,
              marginAmount: 10000
            }
          ]
        ]),
        totalValue: 15000
      };

      // Price dropped to 45000 (profitable for short)
      const prices = new Map([['bitcoin', 45000]]);
      const updated = service.updateValues(portfolio, prices);

      // value = max(0, 10000 + (50000 - 45000) * 1) = 15000
      expect(updated.positions.get('bitcoin')?.totalValue).toBe(15000);
      // total = 5000 cash + 15000 position = 20000
      expect(updated.totalValue).toBe(20000);
    });

    it('should clamp underwater short position value to 0', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([
          [
            'bitcoin',
            {
              coinId: 'bitcoin',
              quantity: 1,
              averagePrice: 50000,
              totalValue: 10000,
              side: 'short' as const,
              leverage: 5,
              marginAmount: 10000
            }
          ]
        ]),
        totalValue: 15000
      };

      // Price rose to 65000 => unrealized loss = -15000 > margin = 10000
      const prices = new Map([['bitcoin', 65000]]);
      const updated = service.updateValues(portfolio, prices);

      // value = max(0, 10000 + (50000 - 65000) * 1) = max(0, -5000) = 0
      expect(updated.positions.get('bitcoin')?.totalValue).toBe(0);
      expect(updated.totalValue).toBe(5000); // cash only
    });

    it('should correctly update mix of long and short positions', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([
          [
            'bitcoin',
            {
              coinId: 'bitcoin',
              quantity: 1,
              averagePrice: 50000,
              totalValue: 10000,
              side: 'short' as const,
              leverage: 5,
              marginAmount: 10000
            }
          ],
          [
            'ethereum',
            {
              coinId: 'ethereum',
              quantity: 2,
              averagePrice: 2000,
              totalValue: 4000
            }
          ]
        ]),
        totalValue: 19000
      };

      const prices = new Map([
        ['bitcoin', 48000], // Short profit
        ['ethereum', 2500] // Long profit
      ]);

      const updated = service.updateValues(portfolio, prices);

      // Short bitcoin: max(0, 10000 + (50000-48000)*1) = 12000
      expect(updated.positions.get('bitcoin')?.totalValue).toBe(12000);
      // Long ethereum: 2 * 2500 = 5000
      expect(updated.positions.get('ethereum')?.totalValue).toBe(5000);
      // Total = 5000 + 12000 + 5000 = 22000
      expect(updated.totalValue).toBe(22000);
    });

    it('should use stored totalValue when price is missing for short position', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([
          [
            'bitcoin',
            {
              coinId: 'bitcoin',
              quantity: 1,
              averagePrice: 50000,
              totalValue: 10000,
              side: 'short' as const,
              leverage: 5,
              marginAmount: 10000
            }
          ]
        ]),
        totalValue: 15000
      };

      // No price for bitcoin
      const prices = new Map<string, number>();
      const updated = service.updateValues(portfolio, prices);

      expect(updated.positions.get('bitcoin')?.totalValue).toBe(10000);
      expect(updated.totalValue).toBe(15000);
    });
  });

  describe('calculatePositionsValue with short positions', () => {
    it('should value short position using margin + unrealized P&L', () => {
      const positions = new Map([
        [
          'bitcoin',
          {
            coinId: 'bitcoin',
            quantity: 1,
            averagePrice: 50000,
            totalValue: 10000,
            side: 'short' as const,
            leverage: 5,
            marginAmount: 10000
          } as const
        ]
      ]);

      const prices = new Map([['bitcoin', 45000]]);
      const value = service.calculatePositionsValue(positions, prices);

      // max(0, 10000 + (50000 - 45000) * 1) = 15000
      expect(value).toBe(15000);
    });

    it('should clamp underwater short value to 0', () => {
      const positions = new Map([
        [
          'bitcoin',
          {
            coinId: 'bitcoin',
            quantity: 1,
            averagePrice: 50000,
            totalValue: 10000,
            side: 'short' as const,
            leverage: 5,
            marginAmount: 10000
          } as const
        ]
      ]);

      const prices = new Map([['bitcoin', 65000]]);
      const value = service.calculatePositionsValue(positions, prices);

      // max(0, 10000 + (50000 - 65000) * 1) = max(0, -5000) = 0
      expect(value).toBe(0);
    });

    it('should sum mix of long and short positions correctly', () => {
      const positions = new Map([
        [
          'bitcoin',
          {
            coinId: 'bitcoin',
            quantity: 1,
            averagePrice: 50000,
            totalValue: 10000,
            side: 'short' as const,
            leverage: 5,
            marginAmount: 10000
          } as const
        ],
        [
          'ethereum',
          {
            coinId: 'ethereum',
            quantity: 2,
            averagePrice: 2000,
            totalValue: 4000
          }
        ]
      ]);

      const prices = new Map([
        ['bitcoin', 48000],
        ['ethereum', 2500]
      ]);

      const value = service.calculatePositionsValue(positions, prices);

      // Short bitcoin: max(0, 10000 + (50000-48000)*1) = 12000
      // Long ethereum: 2 * 2500 = 5000
      expect(value).toBe(17000);
    });

    it('should fall back to stored totalValue for short when no price', () => {
      const positions = new Map([
        [
          'bitcoin',
          {
            coinId: 'bitcoin',
            quantity: 1,
            averagePrice: 50000,
            totalValue: 10000,
            side: 'short' as const,
            leverage: 5,
            marginAmount: 10000
          } as const
        ]
      ]);

      const value = service.calculatePositionsValue(positions, new Map());

      expect(value).toBe(10000); // Falls back to totalValue
    });
  });

  describe('serialize/deserialize with short positions', () => {
    it('should serialize short position fields', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([
          [
            'bitcoin',
            {
              coinId: 'bitcoin',
              quantity: 1,
              averagePrice: 50000,
              totalValue: 10000,
              side: 'short' as const,
              leverage: 5,
              marginAmount: 10000,
              liquidationPrice: 59750
            }
          ]
        ]),
        totalValue: 15000,
        totalMarginUsed: 10000,
        availableMargin: 5000
      };

      const serialized = service.serialize(portfolio);

      expect(serialized.positions).toHaveLength(1);
      const serializedPos = serialized.positions[0];
      expect(serializedPos.side).toBe('short');
      expect(serializedPos.leverage).toBe(5);
      expect(serializedPos.marginAmount).toBe(10000);
      expect(serializedPos.liquidationPrice).toBe(59750);
    });

    it('should deserialize short position fields', () => {
      const serialized: SerializablePortfolio = {
        cashBalance: 5000,
        positions: [
          {
            coinId: 'bitcoin',
            quantity: 1,
            averagePrice: 50000,
            side: 'short',
            leverage: 5,
            marginAmount: 10000,
            liquidationPrice: 59750
          }
        ]
      };

      const prices = new Map([['bitcoin', 48000]]);
      const portfolio = service.deserialize(serialized, prices);

      const pos = portfolio.positions.get('bitcoin');
      expect(pos).toBeDefined();
      expect(pos?.side).toBe('short');
      expect(pos?.leverage).toBe(5);
      expect(pos?.marginAmount).toBe(10000);
      expect(pos?.liquidationPrice).toBe(59750);
      // totalValue = marginAmount + (entryPrice - currentPrice) * quantity
      // = 10000 + (50000 - 48000) * 1 = 12000
      expect(pos?.totalValue).toBe(12000);
    });

    it('should calculate totalMarginUsed correctly on deserialize', () => {
      const serialized: SerializablePortfolio = {
        cashBalance: 5000,
        positions: [
          {
            coinId: 'bitcoin',
            quantity: 1,
            averagePrice: 50000,
            side: 'short',
            leverage: 5,
            marginAmount: 10000,
            liquidationPrice: 59750
          },
          {
            coinId: 'ethereum',
            quantity: 10,
            averagePrice: 2000,
            side: 'short',
            leverage: 3,
            marginAmount: 6666.67,
            liquidationPrice: 2653.33
          }
        ]
      };

      const prices = new Map([
        ['bitcoin', 49000],
        ['ethereum', 1900]
      ]);

      const portfolio = service.deserialize(serialized, prices);

      // totalMarginUsed = 10000 + 6666.67 = 16666.67
      expect(portfolio.totalMarginUsed).toBeCloseTo(16666.67, 1);
      expect(portfolio.availableMargin).toBe(5000);
    });

    it('should round-trip short position fields through serialize/deserialize', () => {
      const original: Portfolio = {
        cashBalance: 5000,
        positions: new Map([
          [
            'bitcoin',
            {
              coinId: 'bitcoin',
              quantity: 1,
              averagePrice: 50000,
              totalValue: 10000,
              side: 'short' as const,
              leverage: 5,
              marginAmount: 10000,
              liquidationPrice: 59750
            }
          ]
        ]),
        totalValue: 15000,
        totalMarginUsed: 10000,
        availableMargin: 5000
      };

      const serialized = service.serialize(original);
      const restored = service.deserialize(serialized);

      expect(restored.cashBalance).toBe(original.cashBalance);

      const restoredPos = restored.positions.get('bitcoin');
      const originalPos = original.positions.get('bitcoin');
      expect(restoredPos?.quantity).toBe(originalPos?.quantity);
      expect(restoredPos?.averagePrice).toBe(originalPos?.averagePrice);
      expect(restoredPos?.side).toBe(originalPos?.side);
      expect(restoredPos?.leverage).toBe(originalPos?.leverage);
      expect(restoredPos?.marginAmount).toBe(originalPos?.marginAmount);
      expect(restoredPos?.liquidationPrice).toBe(originalPos?.liquidationPrice);
    });

    it('should not serialize undefined short fields for long positions', () => {
      const portfolio: Portfolio = {
        cashBalance: 5000,
        positions: new Map([['bitcoin', { coinId: 'bitcoin', quantity: 0.1, averagePrice: 45000, totalValue: 4500 }]]),
        totalValue: 9500
      };

      const serialized = service.serialize(portfolio);

      expect(serialized.positions[0].side).toBeUndefined();
      expect(serialized.positions[0].leverage).toBeUndefined();
      expect(serialized.positions[0].marginAmount).toBeUndefined();
      expect(serialized.positions[0].liquidationPrice).toBeUndefined();
    });

    it('should handle deserialize with mix of long and short positions', () => {
      const serialized: SerializablePortfolio = {
        cashBalance: 5000,
        positions: [
          {
            coinId: 'bitcoin',
            quantity: 1,
            averagePrice: 50000,
            side: 'short',
            leverage: 5,
            marginAmount: 10000,
            liquidationPrice: 59750
          },
          {
            coinId: 'ethereum',
            quantity: 2,
            averagePrice: 2000
          }
        ]
      };

      const prices = new Map([
        ['bitcoin', 49000],
        ['ethereum', 2500]
      ]);

      const portfolio = service.deserialize(serialized, prices);

      // Short bitcoin totalValue = 10000 + (50000-49000)*1 = 11000
      expect(portfolio.positions.get('bitcoin')?.totalValue).toBe(11000);
      // Long ethereum totalValue = 2 * 2500 = 5000
      expect(portfolio.positions.get('ethereum')?.totalValue).toBe(5000);
      // Total = 5000 + 11000 + 5000 = 21000
      expect(portfolio.totalValue).toBe(21000);
      // Only the short counts toward margin
      expect(portfolio.totalMarginUsed).toBe(10000);
    });
  });

  describe('applyBuy conflict with short position', () => {
    it('should reject buy when short position exists for same coin', () => {
      const portfolio: Portfolio = {
        cashBalance: 10000,
        positions: new Map([
          [
            'bitcoin',
            {
              coinId: 'bitcoin',
              quantity: 0.1,
              averagePrice: 50000,
              totalValue: 1000,
              side: 'short' as const,
              leverage: 5,
              marginAmount: 1000,
              liquidationPrice: 59750
            }
          ]
        ]),
        totalValue: 11000
      };

      const result = service.applyBuy(portfolio, 'bitcoin', 0.1, 50000, 10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('short position already exists');
    });
  });
});
