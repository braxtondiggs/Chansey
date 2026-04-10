import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { SignalSource, SignalStatus } from '@chansey/api-interfaces';

import { SignalActivityFeedDto, SignalFeedItemDto, SignalHealthSummaryDto } from './dto/signal-activity-feed.dto';
import { resolveInstrumentSymbols } from './monitoring-shared.util';

import { Coin } from '../../coin/coin.entity';
import { BacktestSignal, SignalDirection, SignalType } from '../../order/backtest/backtest-signal.entity';
import { Backtest, BacktestStatus } from '../../order/backtest/backtest.entity';
import {
  PaperTradingSession,
  PaperTradingStatus
} from '../../order/paper-trading/entities/paper-trading-session.entity';
import {
  PaperTradingSignal,
  PaperTradingSignalStatus
} from '../../order/paper-trading/entities/paper-trading-signal.entity';
import { LiveTradingSignal } from '../../strategy/entities/live-trading-signal.entity';

const SIGNAL_FEED_MAX = 500;

/** Explicit mapping from PaperTradingSignalStatus to the shared SignalStatus enum */
const PAPER_SIGNAL_STATUS_MAP: Record<PaperTradingSignalStatus, SignalStatus> = {
  [PaperTradingSignalStatus.PENDING]: SignalStatus.PENDING,
  [PaperTradingSignalStatus.SIMULATED]: SignalStatus.SIMULATED,
  [PaperTradingSignalStatus.REJECTED]: SignalStatus.REJECTED,
  [PaperTradingSignalStatus.ERROR]: SignalStatus.ERROR
};

@Injectable()
export class SignalActivityFeedService {
  constructor(
    @InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(BacktestSignal) private readonly signalRepo: Repository<BacktestSignal>,
    @InjectRepository(PaperTradingSession) private readonly paperSessionRepo: Repository<PaperTradingSession>,
    @InjectRepository(PaperTradingSignal) private readonly paperSignalRepo: Repository<PaperTradingSignal>,
    @InjectRepository(LiveTradingSignal) private readonly liveSignalRepo: Repository<LiveTradingSignal>,
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>
  ) {}

  /**
   * Get a unified signal activity feed combining backtest and paper trading signals
   */
  async getSignalActivityFeed(limit: number): Promise<SignalActivityFeedDto> {
    const effectiveLimit = Math.min(Math.max(1, limit), SIGNAL_FEED_MAX);
    const [signals, health] = await Promise.all([this.getRecentSignals(effectiveLimit), this.getSignalHealth()]);

    return {
      health,
      signals
    };
  }

  private async getRecentSignals(limit: number): Promise<SignalFeedItemDto[]> {
    const [backtestSignals, paperSignals, liveSignals] = await Promise.all([
      this.signalRepo
        .createQueryBuilder('s')
        .innerJoinAndSelect('s.backtest', 'b')
        .innerJoinAndSelect('b.algorithm', 'a')
        .innerJoinAndSelect('b.user', 'u')
        .select([
          's.id',
          's.timestamp',
          's.signalType',
          's.direction',
          's.instrument',
          's.quantity',
          's.price',
          's.confidence',
          's.reason',
          'b.id',
          'b.name',
          'a.name',
          'u.email'
        ])
        .orderBy('s.timestamp', 'DESC')
        .take(limit)
        .getMany(),
      this.paperSignalRepo
        .createQueryBuilder('ps')
        .innerJoinAndSelect('ps.session', 'sess')
        .innerJoinAndSelect('sess.algorithm', 'a')
        .innerJoinAndSelect('sess.user', 'u')
        .select([
          'ps.id',
          'ps.createdAt',
          'ps.signalType',
          'ps.direction',
          'ps.instrument',
          'ps.quantity',
          'ps.price',
          'ps.confidence',
          'ps.reason',
          'ps.processed',
          'sess.id',
          'sess.name',
          'a.name',
          'u.email'
        ])
        .orderBy('ps.createdAt', 'DESC')
        .take(limit)
        .getMany(),
      this.liveSignalRepo
        .createQueryBuilder('ls')
        .leftJoinAndSelect('ls.user', 'u')
        .leftJoinAndSelect('ls.strategyConfig', 'sc')
        .leftJoinAndSelect('sc.algorithm', 'sca')
        .leftJoinAndSelect('ls.algorithmActivation', 'aa')
        .leftJoinAndSelect('aa.algorithm', 'aaa')
        .select([
          'ls.id',
          'ls.createdAt',
          'ls.action',
          'ls.symbol',
          'ls.quantity',
          'ls.price',
          'ls.confidence',
          'ls.status',
          'ls.reasonCode',
          'ls.reason',
          'ls.strategyConfigId',
          'ls.algorithmActivationId',
          'u.email',
          'sc.id',
          'sc.name',
          'sca.name',
          'aa.id',
          'aaa.name'
        ])
        .orderBy('ls.createdAt', 'DESC')
        .take(limit)
        .getMany()
    ]);

    const mapped: SignalFeedItemDto[] = [];

    for (const s of backtestSignals) {
      mapped.push({
        id: s.id,
        timestamp: s.timestamp.toISOString(),
        signalType: s.signalType,
        direction: s.direction,
        instrument: s.instrument?.toUpperCase() ?? s.instrument,
        quantity: s.quantity,
        price: s.price ?? undefined,
        confidence: s.confidence ?? undefined,
        status: SignalStatus.RECORDED,
        reasonCode: undefined,
        reason: s.reason ?? undefined,
        source: SignalSource.BACKTEST,
        sourceId: s.backtest.id,
        sourceName: s.backtest.name,
        algorithmName: s.backtest.algorithm?.name || 'Unknown',
        userEmail: s.backtest.user?.email
      });
    }

    for (const ps of paperSignals) {
      mapped.push({
        id: ps.id,
        timestamp: ps.createdAt.toISOString(),
        signalType: ps.signalType as unknown as SignalType,
        direction: ps.direction as unknown as SignalDirection,
        instrument: ps.instrument?.toUpperCase() ?? ps.instrument,
        quantity: ps.quantity,
        price: ps.price ?? undefined,
        confidence: ps.confidence ?? undefined,
        status: ps.status
          ? PAPER_SIGNAL_STATUS_MAP[ps.status]
          : ps.processed
            ? SignalStatus.PROCESSED
            : SignalStatus.PENDING,
        reasonCode: ps.rejectionCode ?? undefined,
        reason: ps.reason ?? undefined,
        source: SignalSource.PAPER_TRADING,
        sourceId: ps.session.id,
        sourceName: ps.session.name,
        algorithmName: ps.session.algorithm?.name || 'Unknown',
        userEmail: ps.session.user?.email,
        processed: ps.processed
      });
    }

    for (const ls of liveSignals) {
      mapped.push({
        id: ls.id,
        timestamp: ls.createdAt.toISOString(),
        signalType: this.mapLiveSignalType(ls.action),
        direction: this.mapLiveSignalDirection(ls.action),
        instrument: ls.symbol?.toUpperCase() ?? ls.symbol,
        quantity: ls.quantity,
        price: ls.price ?? undefined,
        confidence: ls.confidence ?? undefined,
        status: ls.status,
        reasonCode: ls.reasonCode ?? undefined,
        reason: ls.reason ?? undefined,
        source: SignalSource.LIVE_TRADING,
        sourceId: ls.strategyConfigId ?? ls.algorithmActivationId ?? ls.id,
        sourceName: ls.strategyConfig?.name ?? ls.algorithmActivation?.id ?? 'Live trading',
        algorithmName: ls.strategyConfig?.algorithm?.name ?? ls.algorithmActivation?.algorithm?.name ?? 'Unknown',
        userEmail: ls.user?.email
      });
    }

    // Resolve instrument UUIDs to coin symbols
    const instrumentSet = new Set(mapped.map((m) => m.instrument).filter(Boolean) as string[]);
    const resolver = await resolveInstrumentSymbols(this.coinRepo, instrumentSet);
    for (const item of mapped) {
      if (item.instrument) {
        item.instrument = resolver.resolve(item.instrument) ?? item.instrument;
      }
    }

    // Sort merged by timestamp DESC, take limit
    mapped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return mapped.slice(0, limit);
  }

  private async getSignalHealth(): Promise<SignalHealthSummaryDto> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [backtestStats, paperStats, liveStats, activeBacktests, activePaperSessions] = await Promise.all([
      this.signalRepo
        .createQueryBuilder('s')
        .select('MAX(s.timestamp)', 'maxTs')
        .addSelect(`COUNT(*) FILTER (WHERE s.timestamp >= :oneHourAgo)`, 'hourCount')
        .addSelect(`COUNT(*) FILTER (WHERE s.timestamp >= :oneDayAgo)`, 'dayCount')
        .setParameter('oneHourAgo', oneHourAgo)
        .setParameter('oneDayAgo', oneDayAgo)
        .getRawOne(),
      this.paperSignalRepo
        .createQueryBuilder('ps')
        .select('MAX(ps.createdAt)', 'maxTs')
        .addSelect(`COUNT(*) FILTER (WHERE ps.createdAt >= :oneHourAgo)`, 'hourCount')
        .addSelect(`COUNT(*) FILTER (WHERE ps.createdAt >= :oneDayAgo)`, 'dayCount')
        .setParameter('oneHourAgo', oneHourAgo)
        .setParameter('oneDayAgo', oneDayAgo)
        .getRawOne(),
      this.liveSignalRepo
        .createQueryBuilder('ls')
        .select('MAX(ls.createdAt)', 'maxTs')
        .addSelect(`COUNT(*) FILTER (WHERE ls.createdAt >= :oneHourAgo)`, 'hourCount')
        .addSelect(`COUNT(*) FILTER (WHERE ls.createdAt >= :oneDayAgo)`, 'dayCount')
        .setParameter('oneHourAgo', oneHourAgo)
        .setParameter('oneDayAgo', oneDayAgo)
        .getRawOne(),
      this.backtestRepo.count({ where: { status: BacktestStatus.RUNNING } }),
      this.paperSessionRepo.count({ where: { status: PaperTradingStatus.ACTIVE } })
    ]);

    const backtestMax = backtestStats?.maxTs ? new Date(backtestStats.maxTs) : null;
    const paperMax = paperStats?.maxTs ? new Date(paperStats.maxTs) : null;
    const liveMax = liveStats?.maxTs ? new Date(liveStats.maxTs) : null;

    let lastSignalTime: string | undefined;
    let lastSignalAgoMs: number | undefined;

    const latest = [backtestMax, paperMax, liveMax]
      .filter((value): value is Date => value != null)
      .sort((left, right) => right.getTime() - left.getTime())[0];

    if (latest) {
      lastSignalTime = latest.toISOString();
      lastSignalAgoMs = now.getTime() - latest.getTime();
    }

    const totalActiveSources = activeBacktests + activePaperSessions;

    return {
      lastSignalTime,
      lastSignalAgoMs,
      signalsLastHour:
        (parseInt(backtestStats?.hourCount, 10) || 0) +
        (parseInt(paperStats?.hourCount, 10) || 0) +
        (parseInt(liveStats?.hourCount, 10) || 0),
      signalsLast24h:
        (parseInt(backtestStats?.dayCount, 10) || 0) +
        (parseInt(paperStats?.dayCount, 10) || 0) +
        (parseInt(liveStats?.dayCount, 10) || 0),
      activeBacktestSources: activeBacktests,
      activePaperTradingSources: activePaperSessions,
      totalActiveSources
    };
  }

  private mapLiveSignalType(action: string): SignalType {
    return action === 'buy' || action === 'short_entry' ? SignalType.ENTRY : SignalType.EXIT;
  }

  private mapLiveSignalDirection(action: string): SignalDirection {
    return action === 'short_entry' || action === 'short_exit' ? SignalDirection.SHORT : SignalDirection.LONG;
  }
}
