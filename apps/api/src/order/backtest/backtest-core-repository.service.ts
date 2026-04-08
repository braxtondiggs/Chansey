import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { randomUUID } from 'node:crypto';

import { BacktestRunCollection } from '@chansey/api-interfaces';

import { BacktestMapper } from './backtest-mapper.service';
import { backtestConfig } from './backtest.config';
import { Backtest, BacktestType } from './backtest.entity';
import { BacktestJobData } from './backtest.job-data';
import { BacktestFiltersDto } from './dto/backtest.dto';

import { BacktestNotFoundException } from '../../common/exceptions/resource';
import { User } from '../../users/users.entity';

const BACKTEST_QUEUE_NAMES = backtestConfig();

const STANDARD_RELATIONS = ['algorithm', 'marketDataSet', 'user'];

@Injectable()
export class BacktestCoreRepository {
  constructor(
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectQueue(BACKTEST_QUEUE_NAMES.historicalQueue) private readonly historicalQueue: Queue,
    @InjectQueue(BACKTEST_QUEUE_NAMES.replayQueue) private readonly replayQueue: Queue
  ) {}

  async save(entity: Backtest): Promise<Backtest> {
    return this.backtestRepository.save(entity);
  }

  async remove(entity: Backtest): Promise<Backtest> {
    return this.backtestRepository.remove(entity);
  }

  async updateById(backtestId: string, partial: QueryDeepPartialEntity<Backtest>): Promise<void> {
    await this.backtestRepository.update(backtestId, partial);
  }

  async fetchBacktestEntity(user: User, backtestId: string, relations: string[] = []): Promise<Backtest> {
    const backtest = await this.backtestRepository.findOne({
      where: { id: backtestId, user: { id: user.id } },
      relations
    });

    if (!backtest) {
      throw new BacktestNotFoundException(backtestId);
    }

    return backtest;
  }

  async fetchWithStandardRelations(user: User, backtestId: string): Promise<Backtest> {
    return this.fetchBacktestEntity(user, backtestId, STANDARD_RELATIONS);
  }

  async ensureRunOwnership(user: User, backtestId: string): Promise<void> {
    const exists = await this.backtestRepository.exist({
      where: { id: backtestId, user: { id: user.id } }
    });
    if (!exists) {
      throw new BacktestNotFoundException(backtestId);
    }
  }

  async findByIdsForUser(userId: string, ids: string[]): Promise<Backtest[]> {
    if (!ids.length) return [];
    return this.backtestRepository.find({
      where: { id: In(ids), user: { id: userId } },
      relations: STANDARD_RELATIONS
    });
  }

  async listForUser(user: User, filters: BacktestFiltersDto, mapper: BacktestMapper): Promise<BacktestRunCollection> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

    const query = this.backtestRepository
      .createQueryBuilder('backtest')
      .leftJoinAndSelect('backtest.algorithm', 'algorithm')
      .leftJoinAndSelect('backtest.marketDataSet', 'marketDataSet')
      .leftJoinAndSelect('backtest.user', 'owner')
      .where('owner.id = :userId', { userId: user.id })
      .orderBy('backtest.createdAt', 'DESC')
      .addOrderBy('backtest.id', 'DESC')
      .take(limit + 1);

    const typeFilter = filters.type ?? filters.mode;
    if (typeFilter) {
      query.andWhere('backtest.type = :type', { type: typeFilter });
    }

    if (filters.algorithmId) {
      query.andWhere('algorithm.id = :algorithmId', { algorithmId: filters.algorithmId });
    }

    if (filters.status) {
      query.andWhere('backtest.status = :status', { status: filters.status });
    }

    if (filters.createdAfter) {
      query.andWhere('backtest.createdAt >= :createdAfter', { createdAfter: new Date(filters.createdAfter) });
    }

    if (filters.createdBefore) {
      query.andWhere('backtest.createdAt <= :createdBefore', { createdBefore: new Date(filters.createdBefore) });
    }

    if (filters.cursor) {
      const cursor = mapper.decodeCursor(filters.cursor);
      if (cursor?.createdAt && cursor?.id) {
        query.andWhere(
          '(backtest.createdAt < :cursorDate OR (backtest.createdAt = :cursorDate AND backtest.id < :cursorId))',
          { cursorDate: new Date(cursor.createdAt), cursorId: cursor.id }
        );
      }
    }

    const rows = await query.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: items.map((run) => mapper.mapRunSummary(run)),
      nextCursor: hasMore
        ? mapper.encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id)
        : undefined
    };
  }

  buildJobPayload(backtest: Backtest, overrides: Partial<BacktestJobData> = {}): BacktestJobData {
    const snapshotDatasetId = backtest.configSnapshot?.dataset?.id;
    const datasetId =
      overrides.datasetId ??
      backtest.marketDataSet?.id ??
      (typeof snapshotDatasetId === 'string' ? snapshotDatasetId : undefined);
    if (!datasetId) {
      throw new InternalServerErrorException('Backtest dataset reference is missing');
    }

    const userId = overrides.userId ?? backtest.user?.id;
    if (!userId) {
      throw new InternalServerErrorException('Backtest user reference is missing');
    }

    const snapshotAlgorithmId = backtest.configSnapshot?.algorithm?.id;
    const algorithmId =
      overrides.algorithmId ??
      backtest.algorithm?.id ??
      (typeof snapshotAlgorithmId === 'string' ? snapshotAlgorithmId : undefined);
    if (!algorithmId) {
      throw new InternalServerErrorException('Backtest algorithm reference is missing');
    }

    return {
      backtestId: backtest.id,
      userId,
      datasetId,
      algorithmId,
      deterministicSeed: overrides.deterministicSeed ?? backtest.deterministicSeed ?? randomUUID(),
      mode: backtest.type
    };
  }

  getQueueForType(type: BacktestType): Queue {
    switch (type) {
      case BacktestType.HISTORICAL:
        return this.historicalQueue;
      case BacktestType.LIVE_REPLAY:
        return this.replayQueue;
      case BacktestType.PAPER_TRADING:
      case BacktestType.STRATEGY_OPTIMIZATION:
        throw new BadRequestException(
          `BacktestType.${type} should not be created via backtestService.createBacktest(). ` +
            `Use the appropriate service: paperTradingService or optimizationService.`
        );
      default: {
        const _exhaustive: never = type;
        throw new Error(`Unknown backtest type: ${type}`);
      }
    }
  }
}
