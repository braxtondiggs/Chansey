import { InternalServerErrorException } from '@nestjs/common';

import * as ccxt from 'ccxt';

import { KrakenFuturesService } from './kraken-futures.service';

// Minimal mock exchange that satisfies the CCXT interface contract
function createMockExchange() {
  return {
    setLeverage: jest.fn().mockResolvedValue(undefined),
    fetchTicker: jest.fn().mockResolvedValue({ last: 50_000, bid: 49_990, ask: 50_010 }),
    createOrder: jest.fn().mockResolvedValue({ id: 'order-1', status: 'open' } as unknown as ccxt.Order),
    fetchPositions: jest
      .fn()
      .mockResolvedValue([{ symbol: 'BTC/USD:USD', contracts: 1 }] as unknown as ccxt.Position[]),
    fetchBalance: jest.fn().mockResolvedValue({
      info: {},
      free: {},
      used: {},
      total: {},
      timestamp: 0,
      datetime: '',
      USD: { total: 10_000, free: 8_000, used: 2_000 },
      BTC: { total: 0.5, free: 0.5, used: 0 }
    }),
    close: jest.fn().mockResolvedValue(undefined)
  } as unknown as ccxt.Exchange;
}

describe('KrakenFuturesService', () => {
  let service: KrakenFuturesService;
  let mockExchange: ReturnType<typeof createMockExchange>;

  beforeEach(() => {
    // Create without DI dependencies — we override getClient manually
    service = new KrakenFuturesService();
    mockExchange = createMockExchange();
    jest.spyOn(service, 'getClient').mockResolvedValue(mockExchange);
  });

  const mockUser = { id: 'user-1' } as any;

  // ── Static properties ──

  it('should have correct exchange metadata', () => {
    expect(service.quoteAsset).toBe('USD');
    expect(service.supportsFutures).toBe(true);
  });

  // ── formatSymbol ──

  describe('formatSymbol', () => {
    it('passes through symbols already in futures format', () => {
      expect(service.formatSymbol('BTC/USD:USD')).toBe('BTC/USD:USD');
    });

    it('converts BTC/USD → BTC/USD:USD', () => {
      expect(service.formatSymbol('BTC/USD')).toBe('BTC/USD:USD');
    });

    it.each([
      ['BTCUSD', 'BTC/USD:USD'],
      ['ETHUSDT', 'ETH/USDT:USDT'],
      ['SOLUSD', 'SOL/USD:USD'],
      ['BUSDUSD', 'BUSD/USD:USD'],
      ['btcusd', 'BTC/USD:USD']
    ])('converts raw format %s → %s', (input, expected) => {
      expect(service.formatSymbol(input)).toBe(expected);
    });

    it('falls back for too-short base like XUSD', () => {
      // 'XUSD' → base = 'X' (1 char) → fails guard → fallback
      expect(service.formatSymbol('XUSD')).toBe('XUSD');
    });
  });

  // ── setLeverage ──

  describe('setLeverage', () => {
    it('calls exchange.setLeverage with correct params', async () => {
      await service.setLeverage(5, 'BTC/USD:USD', mockUser);
      expect(mockExchange.setLeverage).toHaveBeenCalledWith(5, 'BTC/USD:USD');
    });

    it('throws InternalServerErrorException on failure', async () => {
      (mockExchange.setLeverage as jest.Mock).mockRejectedValueOnce(new Error('API error'));
      await expect(service.setLeverage(5, 'BTC/USD:USD', mockUser)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ── createFuturesOrder ──

  describe('createFuturesOrder', () => {
    it('creates a limit order with explicit price', async () => {
      await service.createFuturesOrder(mockUser, 'BTC/USD:USD', 'buy', 1, 1, { price: 49_000 });

      expect(mockExchange.createOrder).toHaveBeenCalledWith('BTC/USD:USD', 'limit', 'buy', 1, 49_000, {});
    });

    it('fetches ticker price when no price provided (buy — adds slippage)', async () => {
      await service.createFuturesOrder(mockUser, 'BTC/USD:USD', 'buy', 1, 1);

      const expectedPrice = 50_000 * 1.001; // last price + 0.1%
      expect(mockExchange.createOrder).toHaveBeenCalledWith('BTC/USD:USD', 'limit', 'buy', 1, expectedPrice, {});
    });

    it('fetches ticker price when no price provided (sell — subtracts slippage)', async () => {
      await service.createFuturesOrder(mockUser, 'BTC/USD:USD', 'sell', 1, 1);

      const expectedPrice = 50_000 * 0.999; // last price - 0.1%
      expect(mockExchange.createOrder).toHaveBeenCalledWith('BTC/USD:USD', 'limit', 'sell', 1, expectedPrice, {});
    });

    it('sets leverage when leverage > 1', async () => {
      await service.createFuturesOrder(mockUser, 'BTC/USD:USD', 'buy', 1, 5);

      expect(mockExchange.setLeverage).toHaveBeenCalledWith(5, 'BTC/USD:USD');
    });

    it('skips setLeverage when leverage is 1', async () => {
      await service.createFuturesOrder(mockUser, 'BTC/USD:USD', 'buy', 1, 1);

      expect(mockExchange.setLeverage).not.toHaveBeenCalled();
    });

    it('throws when ticker has no last price and no explicit price', async () => {
      (mockExchange.fetchTicker as jest.Mock).mockResolvedValueOnce({ last: null });

      await expect(service.createFuturesOrder(mockUser, 'BTC/USD:USD', 'buy', 1, 1)).rejects.toThrow(
        InternalServerErrorException
      );
    });

    it('throws InternalServerErrorException when createOrder fails', async () => {
      (mockExchange.createOrder as jest.Mock).mockRejectedValueOnce(new Error('exchange down'));

      await expect(service.createFuturesOrder(mockUser, 'BTC/USD:USD', 'buy', 1, 1, { price: 49_000 })).rejects.toThrow(
        InternalServerErrorException
      );
    });

    it('throws InternalServerErrorException when fetchTicker fails', async () => {
      (mockExchange.fetchTicker as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

      await expect(service.createFuturesOrder(mockUser, 'BTC/USD:USD', 'buy', 1, 1)).rejects.toThrow(
        InternalServerErrorException
      );
    });

    it('re-throws ISE from inner code without double-wrapping', async () => {
      // When fetchTicker returns null price, an ISE is thrown at line 80.
      // The catch block (line 90) should re-throw it as-is, not wrap it again.
      (mockExchange.fetchTicker as jest.Mock).mockResolvedValueOnce({ last: null });

      await expect(service.createFuturesOrder(mockUser, 'BTC/USD:USD', 'buy', 1, 1)).rejects.toThrow(
        /Cannot determine price/
      );
    });

    it('calls getClient only once per createFuturesOrder invocation', async () => {
      await service.createFuturesOrder(mockUser, 'BTC/USD:USD', 'buy', 1, 5);

      expect(service.getClient).toHaveBeenCalledTimes(1);
    });
  });

  // ── getFuturesPositions ──

  describe('getFuturesPositions', () => {
    it('fetches all positions when no symbol given', async () => {
      const positions = await service.getFuturesPositions(mockUser);

      expect(mockExchange.fetchPositions).toHaveBeenCalledWith(undefined);
      expect(positions).toHaveLength(1);
    });

    it('fetches positions for a specific symbol', async () => {
      await service.getFuturesPositions(mockUser, 'BTC/USD:USD');

      expect(mockExchange.fetchPositions).toHaveBeenCalledWith(['BTC/USD:USD']);
    });
  });

  // ── getBalance ──

  describe('getBalance', () => {
    it('returns non-zero balances excluding CCXT meta keys', async () => {
      const balances = await service.getBalance(mockUser);

      expect(balances).toEqual([
        { asset: 'USD', free: '8000', locked: '2000' },
        { asset: 'BTC', free: '0.5', locked: '0' }
      ]);
    });

    it('throws InternalServerErrorException on failure', async () => {
      (mockExchange.fetchBalance as jest.Mock).mockRejectedValueOnce(new Error('network error'));

      await expect(service.getBalance(mockUser)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ── getFreeBalance (inherited from base class) ──

  describe('getFreeBalance', () => {
    it('returns USD balances from base class implementation', async () => {
      const balances = await service.getFreeBalance(mockUser);

      expect(balances).toEqual([{ asset: 'USD', free: '8000', locked: '2000' }]);
    });
  });

  // ── setMarginMode (inherited no-op) ──

  describe('setMarginMode', () => {
    it('does not throw — inherits base class no-op', async () => {
      await expect(service.setMarginMode('isolated', 'BTC/USD:USD', mockUser)).resolves.toBeUndefined();
    });
  });
});
