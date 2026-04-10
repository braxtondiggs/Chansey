import { Test, type TestingModule } from '@nestjs/testing';

import { SignalReasonCode } from '@chansey/api-interfaces';

import { type EntryGateContext, EntryGateService } from './entry-gate.service';

import { MetricsService } from '../../metrics/metrics.service';
import { TradeCooldownService } from '../../shared/trade-cooldown.service';
import { ConcentrationGateService } from '../concentration-gate.service';
import { DailyLossLimitGateService } from '../daily-loss-limit-gate.service';

describe('EntryGateService', () => {
  let service: EntryGateService;
  let mockDailyLossLimitGate: any;
  let mockConcentrationGate: any;
  let mockTradeCooldownService: any;
  let mockMetricsService: any;

  const baseCtx: EntryGateContext = {
    userId: 'user-1',
    symbol: 'BTC/USDT',
    action: 'BUY',
    portfolioValue: 10000,
    allocationPercentage: 5,
    riskLevel: 3,
    assets: [],
    isDailyLossBlocked: false,
    pipelineId: 'activation:act-1'
  };

  beforeEach(async () => {
    mockDailyLossLimitGate = {};
    mockConcentrationGate = {
      checkTrade: jest.fn().mockReturnValue({ allowed: true })
    };
    mockTradeCooldownService = {
      checkAndClaim: jest.fn().mockResolvedValue({ allowed: true }),
      clearCooldown: jest.fn().mockResolvedValue(undefined)
    };
    mockMetricsService = {
      recordDailyLossGateBlock: jest.fn(),
      recordConcentrationGateBlock: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntryGateService,
        { provide: DailyLossLimitGateService, useValue: mockDailyLossLimitGate },
        { provide: ConcentrationGateService, useValue: mockConcentrationGate },
        { provide: TradeCooldownService, useValue: mockTradeCooldownService },
        { provide: MetricsService, useValue: mockMetricsService }
      ]
    }).compile();

    service = module.get<EntryGateService>(EntryGateService);
  });

  describe('daily loss limit gate', () => {
    it('should block entry BUY when daily loss blocked', async () => {
      const result = await service.checkEntryGates({ ...baseCtx, isDailyLossBlocked: true });

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe(SignalReasonCode.DAILY_LOSS_LIMIT);
      expect(mockMetricsService.recordDailyLossGateBlock).toHaveBeenCalled();
    });

    it('should allow exit SELL even when daily loss blocked', async () => {
      const result = await service.checkEntryGates({
        ...baseCtx,
        action: 'SELL',
        isDailyLossBlocked: true
      });

      expect(result.allowed).toBe(true);
    });

    it('should block short entry (SELL + short) when daily loss blocked', async () => {
      const result = await service.checkEntryGates({
        ...baseCtx,
        action: 'SELL',
        positionSide: 'short',
        isDailyLossBlocked: true
      });

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe(SignalReasonCode.DAILY_LOSS_LIMIT);
    });

    it('should allow short exit (BUY + short) when daily loss blocked', async () => {
      const result = await service.checkEntryGates({
        ...baseCtx,
        action: 'BUY',
        positionSide: 'short',
        isDailyLossBlocked: true
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('existing holding gate', () => {
    it('should block BUY when user already holds the asset', async () => {
      const result = await service.checkEntryGates({
        ...baseCtx,
        action: 'BUY',
        assets: [{ symbol: 'BTC', usdValue: 500 }]
      });

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe(SignalReasonCode.EXISTING_HOLDING);
      expect(result.reason).toContain('BTC');
      expect(result.metadata).toEqual({ existingUsdValue: 500 });
    });

    it('should allow BUY when existing holding is negligible (<=1 USD)', async () => {
      const result = await service.checkEntryGates({
        ...baseCtx,
        action: 'BUY',
        assets: [{ symbol: 'BTC', usdValue: 0.5 }]
      });

      expect(result.allowed).toBe(true);
    });

    it('should allow BUY when user holds a different asset', async () => {
      const result = await service.checkEntryGates({
        ...baseCtx,
        symbol: 'BTC/USDT',
        action: 'BUY',
        assets: [{ symbol: 'ETH', usdValue: 500 }]
      });

      expect(result.allowed).toBe(true);
    });

    it('should match symbol case-insensitively', async () => {
      const result = await service.checkEntryGates({
        ...baseCtx,
        symbol: 'BTC/USDT',
        action: 'BUY',
        assets: [{ symbol: 'btc', usdValue: 100 }]
      });

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe(SignalReasonCode.EXISTING_HOLDING);
    });

    it('should skip existing holding check for SELL', async () => {
      const result = await service.checkEntryGates({
        ...baseCtx,
        action: 'SELL',
        assets: [{ symbol: 'BTC', usdValue: 500 }]
      });

      expect(result.allowed).toBe(true);
    });

    it('should skip existing holding check for short exit (BUY + short)', async () => {
      const result = await service.checkEntryGates({
        ...baseCtx,
        action: 'BUY',
        positionSide: 'short',
        assets: [{ symbol: 'BTC', usdValue: 500 }]
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('concentration gate', () => {
    it('should block when concentration check fails', async () => {
      mockConcentrationGate.checkTrade.mockReturnValue({
        allowed: false,
        reason: 'BTC concentration too high'
      });

      const result = await service.checkEntryGates(baseCtx);

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe(SignalReasonCode.CONCENTRATION_LIMIT);
      expect(mockMetricsService.recordConcentrationGateBlock).toHaveBeenCalled();
    });

    it('should pass estimated trade USD to concentration check', async () => {
      await service.checkEntryGates(baseCtx);

      expect(mockConcentrationGate.checkTrade).toHaveBeenCalledWith(
        [],
        'BTC/USDT',
        500, // 10000 * 5/100
        3,
        'BUY'
      );
    });

    it('should skip concentration gate for exit signals', async () => {
      const result = await service.checkEntryGates({ ...baseCtx, action: 'SELL' });

      expect(result.allowed).toBe(true);
      expect(mockConcentrationGate.checkTrade).not.toHaveBeenCalled();
    });

    it('should still check cooldown for exit signals', async () => {
      await service.checkEntryGates({ ...baseCtx, action: 'SELL' });

      expect(mockTradeCooldownService.checkAndClaim).toHaveBeenCalledWith(
        'user-1',
        'BTC/USDT',
        'SELL',
        'activation:act-1'
      );
    });

    it('should return adjustedQuantity when concentration gate caps position size', async () => {
      mockConcentrationGate.checkTrade.mockReturnValue({
        allowed: true,
        adjustedQuantity: 0.75
      });

      const result = await service.checkEntryGates(baseCtx);

      expect(result.allowed).toBe(true);
      expect(result.adjustedQuantity).toBe(0.75);
      expect(mockTradeCooldownService.checkAndClaim).toHaveBeenCalled();
    });

    it('should reject when adjustedQuantity path hits cooldown block', async () => {
      mockConcentrationGate.checkTrade.mockReturnValue({
        allowed: true,
        adjustedQuantity: 0.5
      });
      mockTradeCooldownService.checkAndClaim.mockResolvedValue({
        allowed: false,
        existingClaim: { pipeline: 'strategy:config-1' }
      });

      const result = await service.checkEntryGates(baseCtx);

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe(SignalReasonCode.TRADE_COOLDOWN);
      expect(result.adjustedQuantity).toBeUndefined();
    });
  });

  describe('trade cooldown gate', () => {
    it('should block when cooldown rejects', async () => {
      mockTradeCooldownService.checkAndClaim.mockResolvedValue({
        allowed: false,
        existingClaim: { pipeline: 'strategy:config-1' }
      });

      const result = await service.checkEntryGates(baseCtx);

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe(SignalReasonCode.TRADE_COOLDOWN);
      expect(result.cooldownClaim).toEqual({ pipeline: 'strategy:config-1' });
    });

    it('should pass pipelineId to cooldown check', async () => {
      await service.checkEntryGates(baseCtx);

      expect(mockTradeCooldownService.checkAndClaim).toHaveBeenCalledWith(
        'user-1',
        'BTC/USDT',
        'BUY',
        'activation:act-1'
      );
    });
  });

  describe('full gate sequence', () => {
    it('should allow when all gates pass', async () => {
      const result = await service.checkEntryGates(baseCtx);

      expect(result.allowed).toBe(true);
    });

    it('should check daily loss before concentration', async () => {
      const callOrder: string[] = [];
      mockConcentrationGate.checkTrade.mockImplementation(() => {
        callOrder.push('concentration');
        return { allowed: true };
      });

      await service.checkEntryGates({ ...baseCtx, isDailyLossBlocked: true });

      // Daily loss should block before concentration is checked
      expect(callOrder).not.toContain('concentration');
    });
  });

  describe('clearCooldownOnFailure', () => {
    it('should delegate to TradeCooldownService', async () => {
      await service.clearCooldownOnFailure('user-1', 'BTC/USDT', 'BUY');

      expect(mockTradeCooldownService.clearCooldown).toHaveBeenCalledWith('user-1', 'BTC/USDT', 'BUY');
    });
  });

  describe('cooldown service error handling', () => {
    it('should allow trade when cooldown service returns fail-open result on Redis error', async () => {
      // TradeCooldownService is designed to fail-open — Redis failure returns { allowed: true }
      mockTradeCooldownService.checkAndClaim.mockResolvedValue({ allowed: true });

      const result = await service.checkEntryGates(baseCtx);

      expect(result.allowed).toBe(true);
    });

    it('should propagate cooldown service error if it throws unexpectedly', async () => {
      // If the cooldown service itself throws (unexpected), EntryGateService does not catch it
      mockTradeCooldownService.checkAndClaim.mockRejectedValue(new Error('Unexpected failure'));

      await expect(service.checkEntryGates(baseCtx)).rejects.toThrow('Unexpected failure');
    });
  });
});
