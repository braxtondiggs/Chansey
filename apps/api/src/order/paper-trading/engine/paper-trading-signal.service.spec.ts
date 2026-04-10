import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { SignalReasonCode } from '@chansey/api-interfaces';

import { type TradingSignal } from './paper-trading-engine.utils';
import { PaperTradingSignalService } from './paper-trading-signal.service';

import {
  type PaperTradingSession,
  PaperTradingSignal,
  PaperTradingSignalDirection,
  PaperTradingSignalStatus,
  PaperTradingSignalType
} from '../entities';

describe('PaperTradingSignalService', () => {
  let service: PaperTradingSignalService;
  let repo: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    repo = {
      create: jest.fn((x: unknown) => x as PaperTradingSignal),
      save: jest.fn((x: unknown) => Promise.resolve(x as PaperTradingSignal))
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PaperTradingSignalService, { provide: getRepositoryToken(PaperTradingSignal), useValue: repo }]
    }).compile();
    service = module.get(PaperTradingSignalService);
  });

  const session = { id: 'sess-1' } as PaperTradingSession;
  const baseSignal: TradingSignal = {
    action: 'BUY',
    coinId: 'BTC',
    symbol: 'BTC/USD',
    reason: 'test',
    confidence: 0.9,
    quantity: 1
  };

  describe('save', () => {
    it('creates and saves a LONG entity for BUY', async () => {
      const result = await service.save(session, baseSignal);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: PaperTradingSignalDirection.LONG,
          signalType: PaperTradingSignalType.ENTRY,
          instrument: 'BTC/USD',
          quantity: 1,
          processed: false,
          session
        })
      );
      expect(repo.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('builds SHORT direction for SELL', async () => {
      await service.save(session, { ...baseSignal, action: 'SELL' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ direction: PaperTradingSignalDirection.SHORT })
      );
    });

    it('defaults quantity to 0 when missing', async () => {
      await service.save(session, { ...baseSignal, quantity: undefined });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ quantity: 0 }));
    });
  });

  describe('markRejected', () => {
    it('sets status, rejectionCode, processed flags and saves', async () => {
      const entity = {} as PaperTradingSignal;
      await service.markRejected(entity, SignalReasonCode.SIGNAL_THROTTLED);
      expect(entity.status).toBe(PaperTradingSignalStatus.REJECTED);
      expect(entity.rejectionCode).toBe(SignalReasonCode.SIGNAL_THROTTLED);
      expect(entity.processed).toBe(true);
      expect(entity.processedAt).toBeInstanceOf(Date);
      expect(repo.save).toHaveBeenCalledWith(entity);
    });
  });

  describe('markSimulated', () => {
    it('sets SIMULATED status and processed flags', async () => {
      const entity = {} as PaperTradingSignal;
      await service.markSimulated(entity);
      expect(entity.status).toBe(PaperTradingSignalStatus.SIMULATED);
      expect(entity.processed).toBe(true);
      expect(repo.save).toHaveBeenCalledWith(entity);
    });
  });

  describe('markError', () => {
    it('sets ERROR status and processed flags', async () => {
      const entity = {} as PaperTradingSignal;
      await service.markError(entity);
      expect(entity.status).toBe(PaperTradingSignalStatus.ERROR);
      expect(entity.processed).toBe(true);
    });
  });

  describe('markProcessed', () => {
    it('sets processed flags without changing status', async () => {
      const entity = { status: PaperTradingSignalStatus.SIMULATED } as PaperTradingSignal;
      await service.markProcessed(entity);
      expect(entity.status).toBe(PaperTradingSignalStatus.SIMULATED);
      expect(entity.processed).toBe(true);
      expect(entity.processedAt).toBeInstanceOf(Date);
    });
  });
});
