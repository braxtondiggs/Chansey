import { Injectable, Logger } from '@nestjs/common';

import { MarketDataSet } from './market-data-set.entity';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { InstrumentUniverseUnresolvedException } from '../../common/exceptions';

const MIN_BASE_SYMBOL_LENGTH = 3;

@Injectable()
export class CoinResolverService {
  private readonly logger = new Logger(CoinResolverService.name);

  constructor(private readonly coinService: CoinService) {}

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
   * @returns Object containing resolved Coin entities and any warning flags
   * @throws InstrumentUniverseUnresolvedException when no instruments can be resolved
   */
  async resolveCoins(dataset: MarketDataSet): Promise<{ coins: Coin[]; warnings: string[] }> {
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

      for (const { base } of unresolvedWithBases) {
        const upperBase = base.toUpperCase();
        const coin = baseSymbolMap.get(upperBase);
        if (coin) {
          const upperCoinSymbol = coin.symbol.toUpperCase();
          if (!resolvedMap.has(upperCoinSymbol)) {
            resolvedMap.set(upperCoinSymbol, coin);
          }
        }
      }
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
      throw new InstrumentUniverseUnresolvedException(dataset.id, instruments, unresolved);
    }

    if (unresolved.length > 0) {
      this.logger.warn(
        `Partial instrument resolution for dataset ${dataset.id}: ` +
          `resolved ${resolved.length}/${instruments.length}, unresolved: [${unresolved.join(', ')}]`
      );
    }

    if (resolved.length > maxInstruments) {
      this.logger.warn(`Truncating instrument universe from ${resolved.length} to ${maxInstruments} coins`);
      warnings.push('instrument_universe_truncated');
    }

    return { coins: resolved.slice(0, maxInstruments), warnings };
  }
}
