import { ExchangeOHLCService } from './exchange-ohlc.service';

import { ExchangeManagerService } from '../../exchange/exchange-manager.service';

const createClient = (overrides: Partial<any> = {}) => ({
  has: { fetchOHLCV: true },
  markets: undefined as any,
  loadMarkets: jest.fn().mockResolvedValue(undefined),
  fetchOHLCV: jest.fn(),
  ...overrides
});

describe('ExchangeOHLCService', () => {
  let service: ExchangeOHLCService;
  let exchangeManager: jest.Mocked<ExchangeManagerService>;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    exchangeManager = {
      getPublicClient: jest.fn()
    } as unknown as jest.Mocked<ExchangeManagerService>;
    configService = { get: jest.fn() };

    service = new ExchangeOHLCService(exchangeManager, configService as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('fetchOHLC returns error when exchange lacks OHLC support', async () => {
    const client = createClient({ has: { fetchOHLCV: false } });
    exchangeManager.getPublicClient.mockResolvedValue(client as any);

    const result = await service.fetchOHLC('binance_us', 'BTC/USD', Date.now());

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not support fetchOHLCV');
  });

  it('fetchOHLC loads markets and maps candles', async () => {
    const client = createClient();
    const candles = [
      [1700000000000, 1, 2, 0.5, 1.5, 10],
      [1700003600000, 1.5, 2.5, 1, 2, 12]
    ];
    client.loadMarkets.mockImplementation(async () => {
      client.markets = { 'BTC/USD': {} };
    });
    client.fetchOHLCV.mockResolvedValue(candles as any);
    exchangeManager.getPublicClient.mockResolvedValue(client as any);

    const result = await service.fetchOHLC('binance_us', 'BTC/USD', 1700000000000, 2);

    expect(client.loadMarkets).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.candles).toHaveLength(2);
    expect(result.candles?.[0].open).toBe(1);
  });

  it('fetchOHLCWithRetry retries on rate limit and succeeds', async () => {
    const fetchSpy = jest
      .spyOn(service, 'fetchOHLC')
      .mockResolvedValueOnce({ success: false, error: 'rate limit exceeded' })
      .mockResolvedValueOnce({ success: true, candles: [] });

    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    const result = await service.fetchOHLCWithRetry('binance_us', 'BTC/USD', 0, 500, 2);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  it('fetchOHLCWithFallback returns first success', async () => {
    const retrySpy = jest
      .spyOn(service, 'fetchOHLCWithRetry')
      .mockResolvedValueOnce({ success: true, candles: [], exchangeSlug: 'binance_us' });

    const result = await service.fetchOHLCWithFallback('BTC/USD', 0, 500);

    expect(retrySpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it('fetchOHLCWithFallback returns combined errors when all fail', async () => {
    jest
      .spyOn(service, 'fetchOHLCWithRetry')
      .mockResolvedValueOnce({ success: false, error: 'fail1' })
      .mockResolvedValueOnce({ success: false, error: 'fail2' })
      .mockResolvedValueOnce({ success: false, error: 'fail3' });

    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    const result = await service.fetchOHLCWithFallback('BTC/USD', 0, 500);

    expect(result.success).toBe(false);
    expect(result.error).toContain('All exchanges failed');
  });

  it('supportsOHLC returns false on client errors', async () => {
    exchangeManager.getPublicClient.mockRejectedValue(new Error('boom'));

    const result = await service.supportsOHLC('binance_us');

    expect(result).toBe(false);
  });

  it('getAvailableSymbols filters supported USD pairs', async () => {
    const client = createClient({
      markets: {
        'BTC/USD': { base: 'BTC', quote: 'USD' },
        'BTC/USDT': { base: 'BTC', quote: 'USDT' },
        'BTC/EUR': { base: 'BTC', quote: 'EUR' },
        'ETH/ZUSD': { base: 'ETH', quote: 'ZUSD' }
      }
    });
    exchangeManager.getPublicClient.mockResolvedValue(client as any);

    const result = await service.getAvailableSymbols('binance_us', 'btc');

    expect(result).toEqual(['BTC/USD', 'BTC/USDT']);
  });
});
