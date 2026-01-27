import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';

import { MarketDataSet } from './market-data-set.entity';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { InstrumentUniverseUnresolvedException } from '../../common/exceptions';
import { MetricsService } from '../../metrics/metrics.service';

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
}

@Injectable()
export class CoinResolverService {
  private readonly logger = new Logger(CoinResolverService.name);

  constructor(
    private readonly coinService: CoinService,
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
    const directCoins = await this.coinService.getMultipleCoinsBySymbol(normalizedSymbols);
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
      const baseCoins = await this.coinService.getMultipleCoinsBySymbol(baseCandidates);
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
    const resolved: Coin[] = [];
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

    // Compute unresolved instruments
    const resolvedSymbols = new Set(resolved.map((c) => c.symbol.toUpperCase()));
    const unresolved = instruments.filter((instrument) => {
      const symbol = instrument.toUpperCase();
      if (resolvedSymbols.has(symbol)) return false;
      const base = this.extractBaseSymbol(symbol);
      return !base || !resolvedSymbols.has(base);
    });

    if (!resolved.length) {
      // Record failed resolution
      this.metricsService?.recordCoinResolution('failed');
      throw new InstrumentUniverseUnresolvedException(dataset.id, instruments, unresolved);
    }

    if (unresolved.length > 0) {
      // Record partial resolution
      this.metricsService?.recordCoinResolution('partial');
      this.logger.warn(
        `Partial instrument resolution for dataset ${dataset.id}: ` +
          `resolved ${resolved.length}/${instruments.length}, unresolved: [${unresolved.join(', ')}]`
      );
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
