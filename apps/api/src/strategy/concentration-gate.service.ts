import { Injectable, Logger } from '@nestjs/common';

import {
  AssetAllocation,
  ConcentrationCheckService,
  ConcentrationGateResult
} from './risk/concentration-check.service';

import { ExchangeBalanceDto } from '../balance/dto';

/**
 * Pre-trade concentration limit gate.
 *
 * Blocks or reduces BUY / short_entry signals when the user's
 * portfolio concentration in a single asset would exceed the
 * risk-level-based hard limit.
 *
 * SELL / short_exit signals always pass so positions can unwind.
 */
@Injectable()
export class ConcentrationGateService {
  private readonly logger = new Logger(ConcentrationGateService.name);

  constructor(private readonly concentrationCheck: ConcentrationCheckService) {}

  buildAssetAllocations(exchangeBalances: ExchangeBalanceDto[]): AssetAllocation[] {
    const assets: AssetAllocation[] = [];

    for (const exchange of exchangeBalances) {
      for (const balance of exchange.balances || []) {
        if (balance.usdValue && balance.usdValue > 0) {
          assets.push({ symbol: balance.asset, usdValue: balance.usdValue });
        }
      }
    }

    return assets;
  }

  checkTrade(
    assets: AssetAllocation[],
    tradeSymbol: string,
    tradeUsdValue: number,
    riskLevel: number,
    action: string,
    overrideLimit?: number | null
  ): ConcentrationGateResult {
    const result = this.concentrationCheck.checkTradeAllowed(
      assets,
      tradeSymbol,
      tradeUsdValue,
      riskLevel,
      action,
      overrideLimit
    );

    if (!result.allowed) {
      this.logger.warn(`Concentration gate blocked: ${result.reason}`);
    } else if (result.adjustedQuantity != null && result.adjustedQuantity < 1) {
      this.logger.log(`Concentration gate reduced trade: ${result.reason}`);
    }

    return result;
  }
}
