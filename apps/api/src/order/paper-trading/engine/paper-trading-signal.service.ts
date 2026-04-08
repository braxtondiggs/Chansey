import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { SignalReasonCode } from '@chansey/api-interfaces';

import { classifySignalType, TradingSignal } from './paper-trading-engine.utils';

import {
  PaperTradingSession,
  PaperTradingSignal,
  PaperTradingSignalDirection,
  PaperTradingSignalStatus
} from '../entities';

/**
 * Persistence helper for PaperTradingSignal entities. Wraps the repeated
 * "save signal → flip processed flags → save again" patterns used throughout
 * the engine tick loop.
 */
@Injectable()
export class PaperTradingSignalService {
  constructor(
    @InjectRepository(PaperTradingSignal)
    private readonly signalRepository: Repository<PaperTradingSignal>
  ) {}

  /** Persist a new PaperTradingSignal row derived from an in-memory TradingSignal. */
  async save(session: PaperTradingSession, signal: TradingSignal): Promise<PaperTradingSignal> {
    const entity = this.signalRepository.create({
      signalType: classifySignalType(signal),
      direction:
        signal.action === 'BUY'
          ? PaperTradingSignalDirection.LONG
          : signal.action === 'SELL' || signal.action === 'OPEN_SHORT' || signal.action === 'CLOSE_SHORT'
            ? PaperTradingSignalDirection.SHORT
            : PaperTradingSignalDirection.FLAT,
      instrument: signal.symbol,
      quantity: signal.quantity ?? 0,
      price: undefined,
      confidence: signal.confidence,
      reason: signal.reason,
      payload: signal.metadata,
      processed: false,
      session
    });

    return this.signalRepository.save(entity);
  }

  /** Mark a persisted signal as rejected with a given reason code. */
  async markRejected(entity: PaperTradingSignal, code: SignalReasonCode): Promise<PaperTradingSignal> {
    entity.status = PaperTradingSignalStatus.REJECTED;
    entity.rejectionCode = code;
    entity.processed = true;
    entity.processedAt = new Date();
    return this.signalRepository.save(entity);
  }

  /** Mark a persisted signal as simulated (intentional HOLD / no-op). */
  async markSimulated(entity: PaperTradingSignal): Promise<PaperTradingSignal> {
    entity.status = PaperTradingSignalStatus.SIMULATED;
    entity.processed = true;
    entity.processedAt = new Date();
    return this.signalRepository.save(entity);
  }

  /** Mark a persisted signal as errored. */
  async markError(entity: PaperTradingSignal): Promise<PaperTradingSignal> {
    entity.status = PaperTradingSignalStatus.ERROR;
    entity.processed = true;
    entity.processedAt = new Date();
    return this.signalRepository.save(entity);
  }

  /** Mark a persisted signal as processed without changing its status. */
  async markProcessed(entity: PaperTradingSignal): Promise<PaperTradingSignal> {
    entity.processed = true;
    entity.processedAt = new Date();
    return this.signalRepository.save(entity);
  }
}
