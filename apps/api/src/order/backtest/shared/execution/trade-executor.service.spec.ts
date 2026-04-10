import { TradeExecutorService } from './trade-executor.service';

import { SignalType } from '../../../../algorithm/interfaces';
import { FeeCalculatorService } from '../fees';
import { type Portfolio, PortfolioStateService } from '../portfolio';
import { SlippageModelType, SlippageService } from '../slippage';
import { type MarketData } from '../types';

const slippageService = new SlippageService();
const feeCalculator = new FeeCalculatorService();
const portfolioState = new PortfolioStateService();

describe('TradeExecutorService', () => {
  let service: TradeExecutorService;

  const noSlippage = { type: SlippageModelType.NONE };

  const createMarketData = (coinId: string, price: number, timestamp?: Date): MarketData => ({
    timestamp: timestamp ?? new Date(),
    prices: new Map([[coinId, price]])
  });

  const createPortfolio = (overrides?: Partial<Portfolio>): Portfolio => ({
    cashBalance: 10000,
    totalValue: 10000,
    positions: new Map(),
    ...overrides
  });

  beforeEach(() => {
    service = new TradeExecutorService(slippageService, feeCalculator, portfolioState);
  });

  describe('signal guards', () => {
    it('returns null for HOLD signal', async () => {
      const portfolio = createPortfolio();
      const result = await service.executeTrade(
        { action: 'HOLD', coinId: 'BTC', reason: 'neutral' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage
      );
      expect(result).toBeNull();
      expect(portfolio.cashBalance).toBe(10000);
    });

    it('returns null when no market price for coin', async () => {
      const portfolio = createPortfolio();
      const result = await service.executeTrade(
        { action: 'BUY', coinId: 'BTC', quantity: 1, reason: 'entry' },
        portfolio,
        { timestamp: new Date(), prices: new Map() },
        0,
        noSlippage
      );
      expect(result).toBeNull();
      expect(portfolio.cashBalance).toBe(10000);
    });
  });

  describe('BUY execution', () => {
    it('sizes position using confidence-based allocation', async () => {
      const portfolio = createPortfolio({ cashBalance: 1000, totalValue: 1000 });
      const result = await service.executeTrade(
        { action: 'BUY', coinId: 'BTC', confidence: 1.0, reason: 'strong entry' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage
      );

      expect(result).toBeTruthy();
      // Default HISTORICAL risk-3 limits: max 12% of $1000 = $120 / $100 = 1.2 BTC
      expect(result?.trade.totalValue).toBeCloseTo(120);
      expect(result?.trade.quantity).toBeCloseTo(1.2);
    });

    it('sizes position using signal.percentage', async () => {
      const portfolio = createPortfolio({ cashBalance: 1000, totalValue: 1000 });
      const result = await service.executeTrade(
        { action: 'BUY', coinId: 'BTC', percentage: 0.1, reason: 'entry' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage
      );

      expect(result?.trade.quantity).toBeCloseTo(1); // 10% of $1000 / $100
      expect(result?.trade.totalValue).toBeCloseTo(100);
    });

    it('falls back to minAllocation when no sizing info provided', async () => {
      const portfolio = createPortfolio({ cashBalance: 1000, totalValue: 1000 });
      const result = await service.executeTrade(
        { action: 'BUY', coinId: 'BTC', reason: 'entry' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage
      );

      expect(result).toBeTruthy();
      // minAllocation default 3% of $1000 = $30 / $100 = 0.3 BTC
      expect(result?.trade.totalValue).toBeCloseTo(30);
    });

    it('applies slippage to execution price and records metadata', async () => {
      const portfolio = createPortfolio({ cashBalance: 200, totalValue: 200 });
      const result = await service.executeTrade(
        { action: 'BUY', coinId: 'BTC', quantity: 1, reason: 'entry' },
        portfolio,
        createMarketData('BTC', 100),
        0.01,
        { type: SlippageModelType.FIXED, fixedBps: 100 }
      );

      // 100 bps = 1% slippage → price 101 for buy
      expect(result?.trade.price).toBeCloseTo(101);
      expect(result?.trade.fee).toBeCloseTo(1.01);
      expect(result?.trade.metadata?.basePrice).toBe(100);
      expect(result?.trade.metadata?.slippageBps).toBe(100);
      expect(portfolio.cashBalance).toBeCloseTo(97.99);
    });

    it('handles partial fills with volume-based slippage', async () => {
      const portfolio = createPortfolio({ cashBalance: 10000, totalValue: 10000 });
      const result = await service.executeTrade(
        { action: 'BUY', coinId: 'BTC', quantity: 1, reason: 'entry' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        { type: SlippageModelType.VOLUME_BASED, baseSlippageBps: 5 },
        50 // very low daily volume
      );

      expect(result).toBeTruthy();
      expect(result?.trade.quantity).toBeGreaterThan(0);
    });
  });

  describe('insufficient funds', () => {
    it('rejects BUY when cash cannot cover trade value plus fees', async () => {
      const portfolio = createPortfolio({ cashBalance: 100, totalValue: 100 });
      const result = await service.executeTrade(
        { action: 'BUY', coinId: 'BTC', quantity: 1, reason: 'entry' },
        portfolio,
        createMarketData('BTC', 100),
        0.01, // 1% fee → need 101 total
        noSlippage
      );

      expect(result).toBeNull();
      expect(portfolio.cashBalance).toBe(100);
    });

    it('allows BUY when cash covers both trade value and fees', async () => {
      const portfolio = createPortfolio({ cashBalance: 101, totalValue: 101 });
      const result = await service.executeTrade(
        { action: 'BUY', coinId: 'BTC', quantity: 1, reason: 'entry' },
        portfolio,
        createMarketData('BTC', 100),
        0.01,
        noSlippage
      );

      expect(result).toBeTruthy();
      expect(portfolio.cashBalance).toBeCloseTo(0);
    });
  });

  describe('SELL execution', () => {
    const createLongPortfolio = (quantity = 10, avgPrice = 100) =>
      createPortfolio({
        cashBalance: 0,
        totalValue: quantity * avgPrice,
        positions: new Map([
          ['BTC', { coinId: 'BTC', quantity, averagePrice: avgPrice, totalValue: quantity * avgPrice }]
        ])
      });

    it('returns null when no existing position', async () => {
      const result = await service.executeTrade(
        { action: 'SELL', coinId: 'BTC', reason: 'exit' },
        createPortfolio(),
        createMarketData('BTC', 100),
        0,
        noSlippage
      );
      expect(result).toBeNull();
    });

    it('calculates realized P&L correctly', async () => {
      const portfolio = createLongPortfolio(10, 10);
      const result = await service.executeTrade(
        { action: 'SELL', coinId: 'BTC', quantity: 4, reason: 'take-profit', confidence: 1 },
        portfolio,
        createMarketData('BTC', 15),
        0,
        noSlippage
      );

      expect(result).toBeTruthy();
      expect(result?.trade.realizedPnL).toBeCloseTo(20); // (15 - 10) * 4
      expect(result?.trade.realizedPnLPercent).toBeCloseTo(0.5); // (15 - 10) / 10
      expect(result?.trade.costBasis).toBeCloseTo(10);
      expect(portfolio.positions.get('BTC')?.quantity).toBeCloseTo(6);
    });

    it('deducts fee from cash balance on sell proceeds', async () => {
      const portfolio = createPortfolio({
        cashBalance: 0,
        totalValue: 1000,
        positions: new Map([['BTC', { coinId: 'BTC', quantity: 1, averagePrice: 100, totalValue: 100 }]])
      });

      const result = await service.executeTrade(
        { action: 'SELL', coinId: 'BTC', quantity: 1, reason: 'exit' },
        portfolio,
        createMarketData('BTC', 200),
        0.01,
        noSlippage
      );

      expect(result).toBeTruthy();
      expect(portfolio.cashBalance).toBeCloseTo(198); // 200 proceeds - 2 fee
      expect(result?.trade.fee).toBeCloseTo(2);
    });

    it('uses signal.percentage for partial sell', async () => {
      const portfolio = createLongPortfolio(10, 100);
      const result = await service.executeTrade(
        { action: 'SELL', coinId: 'BTC', percentage: 0.5, reason: 'partial exit' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage
      );

      expect(result?.trade.quantity).toBeCloseTo(5); // 50% of 10
    });

    it('removes position from portfolio when fully sold', async () => {
      const portfolio = createLongPortfolio(5, 100);
      const result = await service.executeTrade(
        { action: 'SELL', coinId: 'BTC', quantity: 5, reason: 'exit' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage
      );

      expect(result).toBeTruthy();
      expect(portfolio.positions.has('BTC')).toBe(false);
    });
  });

  describe('minimum hold period enforcement', () => {
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const entryDate = new Date('2024-01-01T00:00:00.000Z');

    const createHeldPortfolio = (): Portfolio => ({
      cashBalance: 0,
      totalValue: 1000,
      positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000, entryDate }]])
    });

    it('rejects SELL when position held less than minHoldMs', async () => {
      const portfolio = createHeldPortfolio();
      const result = await service.executeTrade(
        { action: 'SELL', coinId: 'BTC', quantity: 5, reason: 'exit' },
        portfolio,
        createMarketData('BTC', 120, new Date('2024-01-01T12:00:00.000Z')), // 12h after entry
        0,
        noSlippage,
        undefined,
        TWENTY_FOUR_HOURS_MS
      );

      expect(result).toBeNull();
      expect(portfolio.positions.get('BTC')?.quantity).toBe(10);
    });

    it.each([
      { type: SignalType.STOP_LOSS, label: 'STOP_LOSS' },
      { type: SignalType.TAKE_PROFIT, label: 'TAKE_PROFIT' }
    ])('allows $label SELL even within min hold period', async ({ type }) => {
      const portfolio = createHeldPortfolio();
      const result = await service.executeTrade(
        { action: 'SELL', coinId: 'BTC', quantity: 10, reason: 'risk exit', originalType: type },
        portfolio,
        createMarketData('BTC', 80, new Date('2024-01-01T01:00:00.000Z')), // 1h after entry
        0,
        noSlippage,
        undefined,
        TWENTY_FOUR_HOURS_MS
      );

      expect(result).toBeTruthy();
      expect(result?.trade.quantity).toBe(10);
    });

    it('allows SELL after min hold period has elapsed', async () => {
      const portfolio = createHeldPortfolio();
      const result = await service.executeTrade(
        { action: 'SELL', coinId: 'BTC', quantity: 5, reason: 'exit' },
        portfolio,
        createMarketData('BTC', 120, new Date('2024-01-02T01:00:00.000Z')), // 25h after entry
        0,
        noSlippage,
        undefined,
        TWENTY_FOUR_HOURS_MS
      );

      expect(result).toBeTruthy();
      expect(result?.trade.quantity).toBe(5);
    });
  });

  describe('position conflict guards', () => {
    it('blocks BUY when long position already exists', async () => {
      const portfolio = createPortfolio({
        positions: new Map([['BTC', { coinId: 'BTC', quantity: 1, averagePrice: 100, totalValue: 100 }]])
      });

      const result = await service.executeTrade(
        { action: 'BUY', coinId: 'BTC', quantity: 1, reason: 'entry' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage
      );
      expect(result).toBeNull();
    });

    it('blocks BUY when short position already exists', async () => {
      const portfolio = createPortfolio({
        positions: new Map([['BTC', { coinId: 'BTC', quantity: 1, averagePrice: 100, totalValue: 100, side: 'short' }]])
      });

      const result = await service.executeTrade(
        { action: 'BUY', coinId: 'BTC', quantity: 1, reason: 'entry' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage
      );
      expect(result).toBeNull();
    });

    it('blocks OPEN_SHORT when long position exists', async () => {
      const portfolio = createPortfolio({
        positions: new Map([['BTC', { coinId: 'BTC', quantity: 1, averagePrice: 100, totalValue: 100 }]])
      });

      const result = await service.executeTrade(
        { action: 'OPEN_SHORT', coinId: 'BTC', quantity: 1, reason: 'entry' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage
      );
      expect(result).toBeNull();
    });
  });

  describe('OPEN_SHORT execution', () => {
    it('opens short position with correct margin, leverage, and liquidation price', async () => {
      const portfolio = createPortfolio({ cashBalance: 5000, totalValue: 5000 });
      const result = await service.executeTrade(
        { action: 'OPEN_SHORT', coinId: 'BTC', quantity: 2, reason: 'bearish signal' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage,
        undefined,
        undefined,
        undefined,
        undefined,
        2 // 2x leverage
      );

      expect(result).toBeTruthy();
      expect(result?.trade.quantity).toBe(2);
      expect(result?.trade.positionSide).toBe('short');
      expect(result?.trade.leverage).toBe(2);
      // Margin = (2 * 100) / 2 = 100
      expect(result?.trade.marginUsed).toBeCloseTo(100);
      expect(result?.trade.totalValue).toBeCloseTo(100);
      expect(result?.trade.liquidationPrice).toBeDefined();
      expect(portfolio.cashBalance).toBeCloseTo(4900);
      // Position tracked
      const pos = portfolio.positions.get('BTC');
      expect(pos?.side).toBe('short');
      expect(pos?.leverage).toBe(2);
      expect(pos?.quantity).toBe(2);
    });

    it('rejects OPEN_SHORT when cash cannot cover margin plus fees', async () => {
      const portfolio = createPortfolio({ cashBalance: 50, totalValue: 50 });
      const result = await service.executeTrade(
        { action: 'OPEN_SHORT', coinId: 'BTC', quantity: 2, reason: 'bearish' },
        portfolio,
        createMarketData('BTC', 100),
        0.01, // 1% fee on notional (200) = 2
        noSlippage,
        undefined,
        undefined,
        undefined,
        undefined,
        1 // 1x leverage → margin = 200
      );

      expect(result).toBeNull();
      expect(portfolio.cashBalance).toBe(50);
    });
  });

  describe('CLOSE_SHORT execution', () => {
    const createShortPortfolio = (quantity = 10, avgPrice = 100, leverage = 2) => {
      const marginAmount = (quantity * avgPrice) / leverage;
      return createPortfolio({
        cashBalance: 5000,
        totalValue: 5000 + marginAmount,
        totalMarginUsed: marginAmount,
        availableMargin: 5000,
        positions: new Map([
          [
            'BTC',
            {
              coinId: 'BTC',
              quantity,
              averagePrice: avgPrice,
              totalValue: marginAmount,
              side: 'short' as const,
              leverage,
              marginAmount,
              liquidationPrice: avgPrice * (1 + 1 / leverage - 0.05),
              entryDate: new Date('2024-01-01')
            }
          ]
        ])
      });
    };

    it('returns null when no short position exists', async () => {
      const result = await service.executeTrade(
        { action: 'CLOSE_SHORT', coinId: 'BTC', quantity: 1, reason: 'exit' },
        createPortfolio(),
        createMarketData('BTC', 100),
        0,
        noSlippage
      );
      expect(result).toBeNull();
    });

    it('returns null when position exists but is not short', async () => {
      const portfolio = createPortfolio({
        positions: new Map([['BTC', { coinId: 'BTC', quantity: 1, averagePrice: 100, totalValue: 100 }]])
      });
      const result = await service.executeTrade(
        { action: 'CLOSE_SHORT', coinId: 'BTC', quantity: 1, reason: 'exit' },
        portfolio,
        createMarketData('BTC', 100),
        0,
        noSlippage
      );
      expect(result).toBeNull();
    });

    it('closes profitable short and returns margin with P&L', async () => {
      const portfolio = createShortPortfolio(10, 100, 2);
      // Short at 100, close at 80 → profit = (100-80)*qty
      const result = await service.executeTrade(
        { action: 'CLOSE_SHORT', coinId: 'BTC', quantity: 10, reason: 'take profit' },
        portfolio,
        createMarketData('BTC', 80),
        0,
        noSlippage
      );

      expect(result).toBeTruthy();
      expect(result?.trade.quantity).toBe(10);
      expect(result?.trade.positionSide).toBe('short');
      expect(result?.trade.realizedPnL).toBeCloseTo(200); // (100-80)*10
      expect(result?.trade.realizedPnLPercent).toBeCloseTo(0.2); // (100-80)/100
      expect(result?.trade.costBasis).toBe(100);
      // Position fully closed
      expect(portfolio.positions.has('BTC')).toBe(false);
      // Cash increased by returned margin + P&L
      expect(portfolio.cashBalance).toBeCloseTo(5000 + 500 + 200); // original + margin + pnl
    });

    it('partially closes short and updates remaining margin', async () => {
      const portfolio = createShortPortfolio(10, 100, 2);
      const result = await service.executeTrade(
        { action: 'CLOSE_SHORT', coinId: 'BTC', quantity: 4, reason: 'partial exit' },
        portfolio,
        createMarketData('BTC', 90),
        0,
        noSlippage
      );

      expect(result).toBeTruthy();
      expect(result?.trade.quantity).toBe(4);
      // Remaining position
      const pos = portfolio.positions.get('BTC');
      expect(pos).toBeDefined();
      expect(pos?.quantity).toBe(6);
      // Margin proportionally returned: 500 * (4/10) = 200
      expect(result?.trade.marginUsed).toBeCloseTo(200);
      expect(pos?.marginAmount).toBeCloseTo(300); // 500 - 200
    });
  });
});
