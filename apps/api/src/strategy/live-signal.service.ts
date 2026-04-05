import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { SignalReasonCode, SignalSource, SignalStatus } from '@chansey/api-interfaces';

import { LiveTradingSignal, LiveTradingSignalAction } from './entities/live-trading-signal.entity';
import { TradingSignal } from './strategy-executor.service';

import { toErrorInfo } from '../shared/error.util';

export interface RecordLiveSignalOutcomeInput {
  userId: string;
  strategyConfigId?: string;
  algorithmActivationId?: string;
  action: LiveTradingSignalAction;
  symbol: string;
  quantity: number;
  price?: number | null;
  confidence?: number;
  status: SignalStatus;
  reasonCode?: SignalReasonCode;
  reason?: string;
  metadata?: Record<string, unknown>;
  orderId?: string;
  source?: SignalSource;
}

@Injectable()
export class LiveSignalService {
  private readonly logger = new Logger(LiveSignalService.name);

  constructor(
    @InjectRepository(LiveTradingSignal)
    private readonly liveSignalRepo: Repository<LiveTradingSignal>
  ) {}

  async recordOutcome(input: RecordLiveSignalOutcomeInput): Promise<LiveTradingSignal> {
    const entity = this.liveSignalRepo.create({
      userId: input.userId,
      strategyConfigId: input.strategyConfigId,
      algorithmActivationId: input.algorithmActivationId,
      action: input.action,
      symbol: input.symbol,
      quantity: input.quantity,
      price: input.price,
      confidence: input.confidence,
      status: input.status,
      reasonCode: input.reasonCode,
      reason: input.reason,
      metadata: input.metadata,
      orderId: input.orderId,
      ...(input.source != null && { source: input.source })
    });

    return this.liveSignalRepo.save(entity);
  }

  async recordFromTradingSignal(
    userId: string,
    strategyConfigId: string,
    signal: TradingSignal,
    status: SignalStatus,
    details: {
      reasonCode?: SignalReasonCode;
      reason?: string;
      metadata?: Record<string, unknown>;
      orderId?: string;
    }
  ): Promise<void> {
    try {
      await this.recordOutcome({
        userId,
        strategyConfigId,
        action: this.toLiveSignalAction(signal.action as Exclude<TradingSignal['action'], 'hold'>),
        symbol: signal.symbol,
        quantity: signal.quantity,
        price: signal.price,
        confidence: signal.confidence,
        status,
        reasonCode: details.reasonCode,
        reason: details.reason,
        metadata: details.metadata,
        orderId: details.orderId,
        source: SignalSource.LIVE_TRADING
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to record live signal outcome for user ${userId}: ${err.message}`, err.stack);
    }
  }

  private toLiveSignalAction(action: Exclude<TradingSignal['action'], 'hold'>): LiveTradingSignalAction {
    switch (action) {
      case 'buy':
        return LiveTradingSignalAction.BUY;
      case 'sell':
        return LiveTradingSignalAction.SELL;
      case 'short_entry':
        return LiveTradingSignalAction.SHORT_ENTRY;
      case 'short_exit':
        return LiveTradingSignalAction.SHORT_EXIT;
      default:
        throw new Error(`Unknown live signal action: ${action}`);
    }
  }
}
