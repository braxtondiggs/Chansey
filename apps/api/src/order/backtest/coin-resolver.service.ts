import { Injectable, Logger } from '@nestjs/common';

import { MarketDataSet } from './market-data-set.entity';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { InstrumentUniverseUnresolvedException } from '../../common/exceptions';

@Injectable()
export class CoinResolverService {
  private readonly logger = new Logger(CoinResolverService.name);

  constructor(private readonly coinService: CoinService) {}

  /**
   * Resolves a dataset's instrument universe to actual Coin entities.
   * Throws InstrumentUniverseUnresolvedException if no instruments can be resolved.
   * Logs a warning for partial resolution (some but not all instruments resolved).
   *
   * @param dataset The market dataset containing the instrument universe
   * @param maxCoins Maximum number of coins to return (default: 5)
   * @returns Array of resolved Coin entities
   * @throws InstrumentUniverseUnresolvedException when no instruments can be resolved
   */
  async resolveCoins(dataset: MarketDataSet, maxCoins = 5): Promise<Coin[]> {
    const instruments = dataset.instrumentUniverse ?? [];

    if (!instruments.length) {
      throw new InstrumentUniverseUnresolvedException(dataset.id, [], []);
    }

    const resolved: Coin[] = [];
    const unresolved: string[] = [];

    for (const instrument of instruments) {
      const symbol = instrument.toUpperCase();
      let found = false;

      try {
        const direct = await this.coinService.getCoinBySymbol(symbol);
        if (direct) {
          resolved.push(direct);
          found = true;
        }
      } catch (error) {
        this.logger.debug(`Failed to resolve symbol ${symbol}: ${error.message}`);
      }

      if (!found) {
        const baseCandidate = symbol.replace(/(USDT|USD|BTC|ETH)$/i, '');
        if (baseCandidate && baseCandidate !== symbol) {
          try {
            const baseCoin = await this.coinService.getCoinBySymbol(baseCandidate);
            if (baseCoin) {
              resolved.push(baseCoin);
              found = true;
            }
          } catch (error) {
            this.logger.debug(`Failed to resolve base symbol ${baseCandidate}: ${error.message}`);
          }
        }
      }

      if (!found) {
        unresolved.push(instrument);
      }
    }

    if (!resolved.length) {
      throw new InstrumentUniverseUnresolvedException(dataset.id, instruments, unresolved);
    }

    if (unresolved.length > 0) {
      this.logger.warn(
        `Partial instrument resolution for dataset ${dataset.id}: ` +
          `resolved ${resolved.length}/${instruments.length}, unresolved: [${unresolved.join(', ')}]`
      );
    }

    return resolved.slice(0, maxCoins);
  }
}
