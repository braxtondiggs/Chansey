import { type Logger } from '@nestjs/common';

import { TradeCooldownService } from './trade-cooldown.service';

const createRedisMock = () => ({
  eval: jest.fn(),
  del: jest.fn(),
  quit: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn()
});

describe('TradeCooldownService', () => {
  let service: TradeCooldownService;
  let redisMock: ReturnType<typeof createRedisMock>;

  beforeEach(() => {
    jest.clearAllMocks();

    redisMock = createRedisMock();
    service = new TradeCooldownService(redisMock as any);
  });

  describe('checkAndClaim', () => {
    it('returns allowed: true when key is not yet claimed', async () => {
      redisMock.eval.mockResolvedValue([1]);

      const result = await service.checkAndClaim('user-1', 'BTC/USDT', 'BUY', 'strategy:s1');

      expect(result).toEqual({ allowed: true });
    });

    it('returns allowed: false with existingClaim when key is already held', async () => {
      const existingClaim = { pipeline: 'activation:a1', claimedAt: 1700000000000 };
      redisMock.eval.mockResolvedValue([0, JSON.stringify(existingClaim)]);

      const result = await service.checkAndClaim('user-1', 'BTC/USDT', 'BUY', 'strategy:s1');

      expect(result.allowed).toBe(false);
      expect(result.existingClaim).toEqual(existingClaim);
    });

    it('fails open on Redis error (allows trade through)', async () => {
      redisMock.eval.mockRejectedValue(new Error('Connection refused'));
      const warnSpy = jest.spyOn(service['logger'] as Logger, 'warn');

      const result = await service.checkAndClaim('user-1', 'BTC/USDT', 'BUY', 'strategy:s1');

      expect(result).toEqual({ allowed: true });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fail-open'));
    });

    it('builds correct key from userId, symbol, and direction', async () => {
      redisMock.eval.mockResolvedValue([1]);

      await service.checkAndClaim('user-42', 'ETH/USDT', 'SELL', 'activation:a1');

      expect(redisMock.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'trade-cd:user-42:ETH/USDT:SELL',
        expect.any(String),
        expect.any(Number)
      );
    });

    it('passes 11-minute TTL to Lua script', async () => {
      redisMock.eval.mockResolvedValue([1]);

      await service.checkAndClaim('user-1', 'BTC/USDT', 'BUY', 'strategy:s1');

      const ttlArg = redisMock.eval.mock.calls[0][4];
      expect(ttlArg).toBe(11 * 60 * 1000);
    });

    it('returns fallback existingClaim when existing value is missing', async () => {
      redisMock.eval.mockResolvedValue([0, undefined]);

      const result = await service.checkAndClaim('user-1', 'BTC/USDT', 'BUY', 'strategy:s1');

      expect(result.allowed).toBe(false);
      expect(result.existingClaim).toEqual({ pipeline: 'unknown', claimedAt: 0 });
    });

    it('passes claim payload with pipeline and claimedAt to Redis', async () => {
      redisMock.eval.mockResolvedValue([1]);
      const before = Date.now();

      await service.checkAndClaim('user-1', 'BTC/USDT', 'BUY', 'strategy:s1');

      const claimJson = redisMock.eval.mock.calls[0][3] as string;
      const claim = JSON.parse(claimJson);
      expect(claim.pipeline).toBe('strategy:s1');
      expect(claim.claimedAt).toBeGreaterThanOrEqual(before);
      expect(claim.claimedAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('clearCooldown', () => {
    it('calls redis.del with the correct key', async () => {
      redisMock.del.mockResolvedValue(1);

      await service.clearCooldown('user-1', 'BTC/USDT', 'BUY');

      expect(redisMock.del).toHaveBeenCalledWith('trade-cd:user-1:BTC/USDT:BUY');
    });

    it('swallows Redis errors with a warn-level log', async () => {
      redisMock.del.mockRejectedValue(new Error('Connection refused'));
      const warnSpy = jest.spyOn(service['logger'] as Logger, 'warn');

      await expect(service.clearCooldown('user-1', 'BTC/USDT', 'BUY')).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to clear trade cooldown'));
    });
  });
});
