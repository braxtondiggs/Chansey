import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';

import { MarketDataSet } from './market-data-set.entity';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { InstrumentUniverseUnresolvedException } from '../../common/exceptions';
import { MetricsService } from '../../metrics/metrics.service';
import { OHLCService } from '../../ohlc/ohlc.service';

const MIN_BASE_SYMBOL_LENGTH = 3;

/**
 * Options for coin resolution behavior.
 */
export interface CoinResolverOptions {
  /**
   * If true, throw an error when instruments are truncated due to maxInstruments limit
   * instead of silently truncating. Use this when user confirmation is required.
   */
  requireConfirmation?: boolean;

  /**
   * Optional symbol filter for custom coin selection (e.g., level 6 users).
   * When provided, only coins whose symbols match this list will be included.
   */
  symbolFilter?: string[];

  /**
   * Backtest start date — when provided with endDate, enables date-aware filtering:
   * only coins with OHLC data in the range and meeting historical quality thresholds are included.
   */
  startDate?: Date;

  /**
   * Backtest end date — used together with startDate for date-aware filtering.
   */
  endDate?: Date;
}

@Injectable()
export class CoinResolverService {
  private readonly logger = new Logger(CoinResolverService.name);

  constructor(
    private readonly coinService: CoinService,
    private readonly ohlcService: OHLCService,
    @Optional() private readonly metricsService?: MetricsService
  ) {}

  /**
   * Extracts the base asset symbol from a trading pair.
   * Returns null if no valid base can be extracted.
   */
  private extractBaseSymbol(symbol: string): string | null {
    const base = symbol.replace(/(USDT|USD|BTC|ETH)$/i, '');
    if (base && base !== symbol && base.length >= MIN_BASE_SYMBOL_LENGTH) {
      return base;
    }
    return null;
  }

  /**
   * Resolves a dataset's instrument universe to actual Coin entities.
   * Throws InstrumentUniverseUnresolvedException if no instruments can be resolved.
   * Logs a warning for partial resolution (some but not all instruments resolved).
   * Returns warning flags when instruments are truncated due to maxInstruments limit.
   *
   * @param dataset The market dataset containing the instrument universe
   * @param options Optional configuration for resolution behavior
   * @returns Object containing resolved Coin entities and any warning flags
   * @throws InstrumentUniverseUnresolvedException when no instruments can be resolved
   * @throws BadRequestException when requireConfirmation is true and truncation would occur
   */
  async resolveCoins(
    dataset: MarketDataSet,
    options: CoinResolverOptions = {}
  ): Promise<{ coins: Coin[]; warnings: string[] }> {
    const maxInstruments = dataset.maxInstruments ?? 50;
    const warnings: string[] = [];
    const instruments = dataset.instrumentUniverse ?? [];

    if (!instruments.length) {
      throw new InstrumentUniverseUnresolvedException(dataset.id, [], []);
    }

    // Normalize all symbols upfront
    const normalizedSymbols = instruments.map((i) => i.toUpperCase());

    // Batch query: try direct symbol lookup first
    const directCoins = await this.coinService.getMultipleCoinsBySymbol(normalizedSymbols, undefined, {
      includeDelisted: true
    });
    const directSymbolSet = new Set(directCoins.map((c) => c.symbol.toUpperCase()));

    // Record direct resolution count
    this.metricsService?.recordInstrumentsResolved('direct', directCoins.length);

    // Track resolved coins (preserving order and avoiding duplicates)
    const resolvedMap = new Map<string, Coin>();
    for (const coin of directCoins) {
      resolvedMap.set(coin.symbol.toUpperCase(), coin);
    }

    // Find unresolved symbols and compute their base candidates
    const unresolvedWithBases: { original: string; base: string }[] = [];
    for (const symbol of normalizedSymbols) {
      if (!directSymbolSet.has(symbol)) {
        const baseCandidate = this.extractBaseSymbol(symbol);
        if (baseCandidate) {
          unresolvedWithBases.push({ original: symbol, base: baseCandidate });
        }
      }
    }

    // Batch query: try base symbol lookup for unresolved instruments
    if (unresolvedWithBases.length > 0) {
      const baseCandidates = [...new Set(unresolvedWithBases.map((u) => u.base))];
      const baseCoins = await this.coinService.getMultipleCoinsBySymbol(baseCandidates, undefined, {
        includeDelisted: true
      });
      const baseSymbolMap = new Map(baseCoins.map((c) => [c.symbol.toUpperCase(), c]));

      let symbolExtractionCount = 0;
      for (const { base } of unresolvedWithBases) {
        const upperBase = base.toUpperCase();
        const coin = baseSymbolMap.get(upperBase);
        if (coin) {
          const upperCoinSymbol = coin.symbol.toUpperCase();
          if (!resolvedMap.has(upperCoinSymbol)) {
            resolvedMap.set(upperCoinSymbol, coin);
            symbolExtractionCount++;
          }
        }
      }

      // Record symbol extraction resolutions
      this.metricsService?.recordInstrumentsResolved('symbol_extraction', symbolExtractionCount);
    }

    // Build final resolved list preserving original order
    let resolved: Coin[] = [];
    const seenCoinIds = new Set<string>();
    for (const symbol of normalizedSymbols) {
      // Try direct match first
      let coin = resolvedMap.get(symbol);
      // Try base candidate match
      if (!coin) {
        const baseCandidate = this.extractBaseSymbol(symbol);
        if (baseCandidate) {
          coin = resolvedMap.get(baseCandidate);
        }
      }
      if (coin && !seenCoinIds.has(coin.id)) {
        resolved.push(coin);
        seenCoinIds.add(coin.id);
      }
    }

    // Apply symbol filter (e.g., for custom coin selection / level 6 users)
    if (options.symbolFilter?.length) {
      const filterSet = new Set(options.symbolFilter.map((s) => s.toUpperCase()));
      const filtered = resolved.filter((c) => filterSet.has(c.symbol.toUpperCase()));
      resolved = filtered;
    }

    // Capture DB-resolved symbols before quality filtering for accurate logging
    const dbResolvedSymbols = new Set(resolved.map((c) => c.symbol.toUpperCase()));

    // Date-aware filtering: only keep coins that were tradeable and met quality thresholds during the backtest period
    if (options.startDate && options.endDate) {
      const tradeableCoinIds = await this.ohlcService.getCoinsWithCandleDataInRange(
        options.startDate,
        options.endDate,
        resolved.map((c) => c.id)
      );
      const tradeableSet = new Set(tradeableCoinIds);
      const tradeableCoins = resolved.filter((c) => tradeableSet.has(c.id));

      const { coins: qualityFiltered } = await this.coinService.getCoinsByIdsFilteredAtDate(
        tradeableCoins.map((c) => c.id),
        options.startDate,
        100_000_000,
        1_000_000
      );
      const qualifiedIdSet = new Set(qualityFiltered.map((c) => c.id));
      resolved = tradeableCoins.filter((c) => qualifiedIdSet.has(c.id));
    }

    // Compute truly unresolved instruments (not found in DB at all)
    const resolvedSymbols = new Set(resolved.map((c) => c.symbol.toUpperCase()));
    const unresolved = instruments.filter((instrument) => {
      const symbol = instrument.toUpperCase();
      if (dbResolvedSymbols.has(symbol)) return false;
      const base = this.extractBaseSymbol(symbol);
      return !base || !dbResolvedSymbols.has(base);
    });

    // Compute instruments that resolved in DB but were dropped by quality/date filtering
    const filteredByQuality = instruments.filter((instrument) => {
      const symbol = instrument.toUpperCase();
      const base = this.extractBaseSymbol(symbol);
      const inDb = dbResolvedSymbols.has(symbol) || (base != null && dbResolvedSymbols.has(base));
      const inFinal = resolvedSymbols.has(symbol) || (base != null && resolvedSymbols.has(base));
      return inDb && !inFinal;
    });

    if (!resolved.length) {
      // Record failed resolution
      this.metricsService?.recordCoinResolution('failed');
      throw new InstrumentUniverseUnresolvedException(dataset.id, instruments, unresolved);
    }

    if (unresolved.length > 0 || filteredByQuality.length > 0) {
      // Record partial resolution
      this.metricsService?.recordCoinResolution('partial');
      const parts = [`resolved ${resolved.length}/${instruments.length}`];
      if (unresolved.length > 0) {
        parts.push(`unresolved: [${unresolved.join(', ')}]`);
      }
      if (filteredByQuality.length > 0) {
        parts.push(`filtered by quality: [${filteredByQuality.join(', ')}]`);
      }
      this.logger.warn(`Partial instrument resolution for dataset ${dataset.id}: ${parts.join(', ')}`);
    } else {
      // Record successful resolution (all instruments resolved)
      this.metricsService?.recordCoinResolution('success');
    }

    if (resolved.length > maxInstruments) {
      if (options.requireConfirmation) {
        throw new BadRequestException(
          `Dataset has ${resolved.length} resolved instruments but maxInstruments limit is ${maxInstruments}. ` +
            `Update the dataset's maxInstruments setting or proceed without the requireConfirmation flag to allow truncation.`
        );
      }
      this.logger.warn(`Truncating instrument universe from ${resolved.length} to ${maxInstruments} coins`);
      warnings.push('instrument_universe_truncated');
    }

    return { coins: resolved.slice(0, maxInstruments), warnings };
  }
}
