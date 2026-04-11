import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FindOptionsWhere, Repository } from 'typeorm';

import { SessionStatusResponse } from '@chansey/api-interfaces';

import {
  PaperTradingOrderFiltersDto,
  PaperTradingSessionFiltersDto,
  PaperTradingSignalFiltersDto,
  PaperTradingSnapshotFiltersDto
} from './dto';
import {
  PaperTradingAccount,
  PaperTradingOrder,
  PaperTradingSession,
  PaperTradingSignal,
  PaperTradingSnapshot
} from './entities';
import { PaperTradingJobService } from './paper-trading-job.service';

import { getQuoteCurrency } from '../../exchange/constants';
import { User } from '../../users/users.entity';

/**
 * Read-only queries for paper trading sessions and their associated data.
 *
 * Split out from {@link PaperTradingService} to keep that service focused on
 * lifecycle / write operations. All methods here are pure reads (plus access
 * validation via session lookup).
 */
@Injectable()
export class PaperTradingQueryService {
  constructor(
    @InjectRepository(PaperTradingSession)
    private readonly sessionRepository: Repository<PaperTradingSession>,
    @InjectRepository(PaperTradingAccount)
    private readonly accountRepository: Repository<PaperTradingAccount>,
    @InjectRepository(PaperTradingOrder)
    private readonly orderRepository: Repository<PaperTradingOrder>,
    @InjectRepository(PaperTradingSignal)
    private readonly signalRepository: Repository<PaperTradingSignal>,
    @InjectRepository(PaperTradingSnapshot)
    private readonly snapshotRepository: Repository<PaperTradingSnapshot>,
    private readonly jobService: PaperTradingJobService
  ) {}

  /**
   * Find all sessions for a user with optional filters
   */
  async findAll(
    user: User,
    filters: PaperTradingSessionFiltersDto
  ): Promise<{ data: PaperTradingSession[]; total: number }> {
    const where: FindOptionsWhere<PaperTradingSession> = { user: { id: user.id } };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.algorithmId) {
      where.algorithm = { id: filters.algorithmId };
    }
    if (filters.pipelineId) {
      where.pipelineId = filters.pipelineId;
    }

    const [data, total] = await this.sessionRepository.findAndCount({
      where,
      relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange'],
      order: { createdAt: 'DESC' },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0
    });

    return { data, total };
  }

  /**
   * Find a single session by ID
   */
  async findOne(id: string, user: User): Promise<PaperTradingSession> {
    const session = await this.sessionRepository.findOne({
      where: { id, user: { id: user.id } },
      relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange', 'accounts']
    });

    if (!session) {
      throw new NotFoundException(`Paper trading session ${id} not found`);
    }

    return session;
  }

  /**
   * Get orders for a session
   */
  async getOrders(
    sessionId: string,
    user: User,
    filters: PaperTradingOrderFiltersDto
  ): Promise<{ data: PaperTradingOrder[]; total: number }> {
    await this.findOne(sessionId, user); // Validates access

    const where: FindOptionsWhere<PaperTradingOrder> = { session: { id: sessionId } };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.side) {
      where.side = filters.side;
    }
    if (filters.symbol) {
      where.symbol = filters.symbol;
    }

    const [data, total] = await this.orderRepository.findAndCount({
      where,
      relations: ['signal'],
      order: { createdAt: 'DESC' },
      take: filters.limit ?? 100,
      skip: filters.offset ?? 0
    });

    return { data, total };
  }

  /**
   * Get signals for a session
   */
  async getSignals(
    sessionId: string,
    user: User,
    filters: PaperTradingSignalFiltersDto
  ): Promise<{ data: PaperTradingSignal[]; total: number }> {
    await this.findOne(sessionId, user); // Validates access

    const where: FindOptionsWhere<PaperTradingSignal> = { session: { id: sessionId } };

    if (filters.signalType) {
      where.signalType = filters.signalType;
    }
    if (filters.direction) {
      where.direction = filters.direction;
    }
    if (filters.instrument) {
      where.instrument = filters.instrument;
    }
    if (filters.processed !== undefined) {
      where.processed = filters.processed;
    }

    const [data, total] = await this.signalRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: filters.limit ?? 100,
      skip: filters.offset ?? 0
    });

    return { data, total };
  }

  /**
   * Get virtual balances for a session
   */
  async getBalances(sessionId: string, user: User): Promise<PaperTradingAccount[]> {
    await this.findOne(sessionId, user); // Validates access

    return this.accountRepository.find({
      where: { session: { id: sessionId } },
      order: { currency: 'ASC' }
    });
  }

  /**
   * Get snapshots for a session (for charting)
   */
  async getSnapshots(
    sessionId: string,
    user: User,
    filters: PaperTradingSnapshotFiltersDto
  ): Promise<PaperTradingSnapshot[]> {
    await this.findOne(sessionId, user); // Validates access

    const qb = this.snapshotRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.sessionId = :sessionId', { sessionId })
      .orderBy('snapshot.timestamp', 'ASC')
      .take(filters.limit ?? 200);

    if (filters.after) {
      qb.andWhere('snapshot.timestamp > :after', { after: new Date(filters.after) });
    }
    if (filters.before) {
      qb.andWhere('snapshot.timestamp < :before', { before: new Date(filters.before) });
    }

    return qb.getMany();
  }

  /**
   * Get current positions for a session
   */
  async getPositions(
    sessionId: string,
    user: User
  ): Promise<
    Array<{
      symbol: string;
      quantity: number;
      averageCost: number;
      currentPrice?: number;
      marketValue?: number;
      unrealizedPnL?: number;
      unrealizedPnLPercent?: number;
    }>
  > {
    // Verify session exists and belongs to user
    await this.findOne(sessionId, user);

    // Get accounts that have holdings (not quote currency)
    const accounts = await this.accountRepository.find({
      where: { session: { id: sessionId } }
    });

    const quoteCurrency = getQuoteCurrency(accounts.map((a) => a.currency));

    // Filter to only holding accounts with positive balances
    const holdingAccounts = accounts.filter((a) => a.currency !== quoteCurrency && a.total > 0);

    return holdingAccounts.map((account) => ({
      symbol: `${account.currency}/${quoteCurrency}`,
      quantity: account.total,
      averageCost: account.averageCost ?? 0
      // currentPrice, marketValue, unrealizedPnL populated by market data service
    }));
  }

  /**
   * Get performance metrics for a session
   */
  async getPerformance(sessionId: string, user: User): Promise<SessionStatusResponse['metrics']> {
    const session = await this.findOne(sessionId, user);
    return this.jobService.calculateMetrics(session);
  }
}
