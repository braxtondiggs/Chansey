import { PaperTradingThrottleService } from './paper-trading-throttle.service';

describe('PaperTradingThrottleService', () => {
  const makeState = () => ({ lastSignalTime: {}, tradeTimestamps: [] });

  const buildService = () => {
    const signalThrottle = {
      createState: jest.fn().mockImplementation(() => makeState()),
      filterSignals: jest.fn().mockImplementation((signals: any[]) => ({
        accepted: signals,
        rejected: []
      })),
      markExecuted: jest.fn(),
      serialize: jest.fn().mockImplementation((state: any) => ({ ...state, serialized: true })),
      deserialize: jest.fn().mockImplementation((serialized: any) => ({ restored: true, from: serialized }))
    };
    const service = new PaperTradingThrottleService(signalThrottle as any);
    return { service, signalThrottle };
  };

  it('getOrCreate creates state on first call and reuses it thereafter', () => {
    const { service, signalThrottle } = buildService();
    const a = service.getOrCreate('s1');
    const b = service.getOrCreate('s1');
    expect(a).toBe(b);
    expect(signalThrottle.createState).toHaveBeenCalledTimes(1);
    expect(service.has('s1')).toBe(true);
  });

  it('clear removes state', () => {
    const { service } = buildService();
    service.getOrCreate('s1');
    service.clear('s1');
    expect(service.has('s1')).toBe(false);
  });

  it('restore deserializes and stores state; skips if already present', () => {
    const { service, signalThrottle } = buildService();
    service.restore('s1', { foo: 1 } as any);
    expect(signalThrottle.deserialize).toHaveBeenCalledTimes(1);
    expect(service.has('s1')).toBe(true);

    // Second restore should be a no-op (don't overwrite live state)
    service.restore('s1', { foo: 2 } as any);
    expect(signalThrottle.deserialize).toHaveBeenCalledTimes(1);
  });

  it('getSerialized returns undefined when no state exists', () => {
    const { service } = buildService();
    expect(service.getSerialized('missing')).toBeUndefined();
  });

  it('getSerialized delegates to SignalThrottleService.serialize when state exists', () => {
    const { service, signalThrottle } = buildService();
    service.getOrCreate('s1');
    const result = service.getSerialized('s1');
    expect(signalThrottle.serialize).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ serialized: true }));
  });

  it('filter get-or-creates state and delegates to SignalThrottleService.filterSignals', () => {
    const { service, signalThrottle } = buildService();
    const signals = [{ symbol: 'BTC', action: 'BUY' } as any];
    const config = { cooldownMs: 0, maxTradesPerDay: 10, minSellPercent: 0 } as any;
    const now = 1_700_000_000_000;

    const result = service.filter('s1', signals, config, now);

    expect(signalThrottle.createState).toHaveBeenCalledTimes(1);
    expect(signalThrottle.filterSignals).toHaveBeenCalledWith(signals, expect.any(Object), config, now);
    expect(result).toEqual({ accepted: signals, rejected: [] });

    // Second call reuses existing state
    service.filter('s1', signals, config, now + 1);
    expect(signalThrottle.createState).toHaveBeenCalledTimes(1);
  });

  it('markExecuted forwards to SignalThrottleService when state exists', () => {
    const { service, signalThrottle } = buildService();
    service.getOrCreate('s1');
    service.markExecuted('s1', 1_700_000_000_000);
    expect(signalThrottle.markExecuted).toHaveBeenCalledWith(expect.any(Object), 1_700_000_000_000);
  });

  it('markExecuted is a no-op when session has no state', () => {
    const { service, signalThrottle } = buildService();
    service.markExecuted('missing', 1);
    expect(signalThrottle.markExecuted).not.toHaveBeenCalled();
  });

  it('sweepOrphaned removes entries not in active set', () => {
    const { service } = buildService();
    service.getOrCreate('a');
    service.getOrCreate('b');
    service.getOrCreate('c');

    const swept = service.sweepOrphaned(new Set(['b']));
    expect(swept).toBe(2);
    expect(service.has('a')).toBe(false);
    expect(service.has('b')).toBe(true);
    expect(service.has('c')).toBe(false);
  });
});
