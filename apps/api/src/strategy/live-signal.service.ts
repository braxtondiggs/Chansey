import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { SignalReasonCode, SignalSource, SignalStatus } from '@chansey/api-interfaces';

import { LiveTradingSignal, LiveTradingSignalAction } from './entities/live-trading-signal.entity';

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
}
