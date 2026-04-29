import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import { CoinSelectionSource } from './coin-selection-source.enum';
import { CoinSelectionType } from './coin-selection-type.enum';
import { CoinSelection, CoinSelectionRelations } from './coin-selection.entity';
import { CreateCoinSelectionDto, UpdateCoinSelectionDto } from './dto';
import { CoinSelectionHistoricalPriceTask } from './tasks/coin-selection-historical-price.task';

import { ActivePositionGuardService } from '../active-position-guard';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import {
  CoinNotTradableOnUserExchangeException,
  CoinSelectionBlockedException,
  CoinSelectionNotFoundException
} from '../common/exceptions';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { OHLCService } from '../ohlc/ohlc.service';
import { User } from '../users/users.entity';

@Injectable()
export class CoinSelectionService {
  private readonly logger = new Logger(CoinSelectionService.name);

  constructor(
    @InjectRepository(CoinSelection) private readonly coinSelection: Repository<CoinSelection>,
    private readonly historicalPriceTask: CoinSelectionHistoricalPriceTask,
    @Inject(forwardRef(() => OHLCService)) private readonly ohlcService: OHLCService,
    @Inject(forwardRef(() => CoinService)) private readonly coinService: CoinService,
    @Inject(forwardRef(() => ExchangeKeyService)) private readonly exchangeKeyService: ExchangeKeyService,
    private readonly activePositionGuard: ActivePositionGuardService
  ) {}

  /**
   * Returns all coin selections across all users. Internal/system-use only.
   * Used by AlgorithmContextBuilder for background algorithm execution.
   */
  async getCoinSelections(): Promise<CoinSelection[]> {
    return await this.coinSelection.find({
      relations: ['coin']
    });
  }

  async getCoinSelectionCoins(): Promise<Coin[]> {
    const selections = await this.getCoinSelections();
    const coinMap = new Map(selections.map(({ coin }) => [coin.id, coin]));
    return [...coinMap.values()];
  }

  /**
   * Returns distinct uppercase symbols across all users' coin selections
   * (AUTOMATIC + MANUAL + WATCHED). Used by the market-regime task to expand
   * the per-coin regime tracking set beyond a hardcoded list.
   */
  async getEligibleSymbolsForRegimeTracking(): Promise<string[]> {
    const rows = await this.coinSelection
      .createQueryBuilder('coinSelection')
      .innerJoin('coinSelection.coin', 'coin')
      .select('DISTINCT UPPER(coin.symbol)', 'symbol')
      .where('coin.symbol IS NOT NULL')
      .getRawMany<{ symbol: string }>();
    return rows.map(({ symbol }) => symbol);
  }

  async getCoinSelectionById(selectionId: string, userId: string): Promise<CoinSelection> {
    const selection = await this.coinSelection.findOne({
      where: { id: selectionId, user: { id: userId } },
      relations: ['coin']
    });
    if (!selection) throw new CoinSelectionNotFoundException(selectionId);
    return selection;
  }

  async getCoinSelectionsByUser(
    user: User,
    relations?: CoinSelectionRelations[],
    type?: CoinSelectionType
  ): Promise<CoinSelection[]> {
    const whereConditions: { user: { id: string }; type?: CoinSelectionType } = {
      user: {
        id: user.id
      }
    };

    if (type) {
      whereConditions.type = type;
    }

    const selections = await this.coinSelection.find({
      where: whereConditions,
      relations,
      order: relations?.includes(CoinSelectionRelations.COIN) ? { coin: { name: 'ASC' } } : { createdAt: 'ASC' }
    });
    return selections;
  }

  async createCoinSelectionItem(dto: CreateCoinSelectionDto, user: User): Promise<CoinSelection> {
    // Check if selection item already exists for this user, coin, and type
    const existing = await this.coinSelection.findOne({
      where: {
        coin: {
          id: dto.coinId
        },
        user: {
          id: user.id
        },
        type: dto.type,
        source: dto.source ?? IsNull()
      }
    });

    if (existing) {
      return existing;
    }

    // Tradability gate: applies only to MANUAL adds. AUTOMATIC selections are
    // already filtered upstream by getCoinsByRiskLevel(userExchangeIds), and
    // LISTING-source AUTOMATIC adds happen *before* OHLC backfill so they would
    // always fail this check. WATCHED adds are watchlist-only — exchange
    // tradability is irrelevant for displaying a coin in a list.
    if (dto.type === CoinSelectionType.MANUAL) {
      const userExchangeKeys = await this.exchangeKeyService.findAll(user.id);
      const userExchangeIds = userExchangeKeys
        .filter((key) => key.isActive)
        .map((key) => key.exchange?.id)
        .filter((id): id is string => typeof id === 'string');
      const isTradable = await this.coinService.isCoinTradableOnUserExchanges(dto.coinId, userExchangeIds);
      if (!isTradable) {
        const coin = await this.coinService.getCoinById(dto.coinId);
        throw new CoinNotTradableOnUserExchangeException(coin.symbol.toUpperCase(), { coinId: dto.coinId });
      }
    }

    // Create new selection item
    const newSelection = this.coinSelection.create({
      coin: { id: dto.coinId },
      user,
      type: dto.type,
      source: dto.source ?? null
    });

    const savedSelection = await this.coinSelection.save(newSelection);

    // Trigger historical OHLC data fetching for the new selection item
    // This happens asynchronously in the background via BullMQ
    try {
      // Check if there is OHLC data in the database before queuing job
      const candleCount = await this.ohlcService.getCandleCount();
      if (candleCount >= 100) {
        await this.historicalPriceTask.addHistoricalPriceJob(dto.coinId);
      } else {
        this.logger.log(
          `Skipping historical price job for coin ${dto.coinId}: only ${candleCount} OHLC candles in database (minimum 100 required)`
        );
      }
    } catch (error: unknown) {
      // Log error but don't fail the selection creation
      this.logger.error(
        `Failed to queue historical price job for coin ${dto.coinId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );
    }

    return savedSelection;
  }

  async updateCoinSelectionItem(
    selectionId: string,
    userId: string,
    dto: UpdateCoinSelectionDto
  ): Promise<CoinSelection> {
    const data = await this.getCoinSelectionById(selectionId, userId);
    return await this.coinSelection.save(new CoinSelection({ ...data, ...dto }));
  }

  async getManualCoinSelectionSymbols(user: User): Promise<string[]> {
    const items = await this.getCoinSelectionsByUser(user, [CoinSelectionRelations.COIN], CoinSelectionType.MANUAL);
    return items.map((p) => p.coin.symbol.toUpperCase());
  }

  async bulkDeleteAutomaticSelections(userId: string, source?: CoinSelectionSource, excludeCoinIds?: Set<string>) {
    const qb = this.coinSelection
      .createQueryBuilder()
      .delete()
      .from(CoinSelection)
      .where('"userId" = :userId', { userId })
      .andWhere('type = :type', { type: CoinSelectionType.AUTOMATIC });

    if (source) {
      qb.andWhere('source = :source', { source });
    }

    if (excludeCoinIds && excludeCoinIds.size > 0) {
      qb.andWhere('"coinId" NOT IN (:...excludeCoinIds)', {
        excludeCoinIds: [...excludeCoinIds]
      });
    }

    return qb.execute();
  }

  /**
   * Delete coin_selection rows by primary id, scoped to the user.
   * Use this when the caller already knows exactly which rows it observed
   * (avoids the load-then-NOT-IN race in `bulkDeleteAutomaticSelections`).
   */
  async bulkDeleteSelectionsByIds(userId: string, ids: string[]) {
    if (ids.length === 0) return { affected: 0 };
    return this.coinSelection
      .createQueryBuilder()
      .delete()
      .from(CoinSelection)
      .where('"userId" = :userId', { userId })
      .andWhere('id IN (:...ids)', { ids })
      .execute();
  }

  async deleteCoinSelectionItem(selectionId: string, userId: string) {
    const selection = await this.coinSelection.findOne({
      where: { id: selectionId, user: { id: userId } },
      relations: ['coin']
    });

    if (!selection) throw new CoinSelectionNotFoundException(selectionId);

    const activeCoinIds = await this.activePositionGuard.getActivePositionCoinIds(userId);
    if (activeCoinIds.has(selection.coin.id)) {
      throw new CoinSelectionBlockedException(selection.coin.symbol.toUpperCase());
    }

    const response = await this.coinSelection.delete({
      id: selectionId,
      user: {
        id: userId
      }
    });
    if (!response.affected) throw new CoinSelectionNotFoundException(selectionId);
    return response;
  }
}
