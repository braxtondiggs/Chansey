import { Injectable } from '@nestjs/common';

import { CONCENTRATION_LIMITS } from './concentration.constants';

const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'USD', 'TUSD', 'USDP']);

export interface AssetAllocation {
  symbol: string;
  usdValue: number;
}

export interface ConcentrationResult {
  breached: boolean;
  breaches: Array<{
    symbol: string;
    concentration: number;
    limit: number;
  }>;
  warnings: Array<{
    symbol: string;
    concentration: number;
    softLimit: number;
  }>;
  totalValue: number;
}

export interface ConcentrationGateResult {
  allowed: boolean;
  adjustedQuantity?: number;
  reason?: string;
}

@Injectable()
export class ConcentrationCheckService {
  checkConcentration(assets: AssetAllocation[], riskLevel: number, overrideLimit?: number | null): ConcentrationResult {
    const totalValue = assets.reduce((sum, a) => sum + a.usdValue, 0);

    if (totalValue <= 0) {
      return { breached: false, breaches: [], warnings: [], totalValue: 0 };
    }

    const { hard, soft } = this.resolveLimits(riskLevel, overrideLimit);

    // Aggregate by base symbol
    const aggregated = this.aggregateByBaseSymbol(assets);

    const breaches: ConcentrationResult['breaches'] = [];
    const warnings: ConcentrationResult['warnings'] = [];

    for (const [symbol, usdValue] of aggregated) {
      if (this.isStablecoin(symbol)) continue;

      const concentration = usdValue / totalValue;

      if (concentration >= hard) {
        breaches.push({ symbol, concentration, limit: hard });
      } else if (concentration >= soft) {
        warnings.push({ symbol, concentration, softLimit: soft });
      }
    }

    return {
      breached: breaches.length > 0,
      breaches,
      warnings,
      totalValue
    };
  }

  checkTradeAllowed(
    assets: AssetAllocation[],
    tradeSymbol: string,
    tradeUsdValue: number,
    riskLevel: number,
    action: string,
    overrideLimit?: number | null
  ): ConcentrationGateResult {
    // SELLs and short exits always pass
    const normalizedAction = action.toLowerCase();
    if (normalizedAction === 'sell' || normalizedAction === 'short_exit') {
      return { allowed: true };
    }

    const baseSymbol = this.extractBaseSymbol(tradeSymbol);

    // Stablecoins always pass
    if (this.isStablecoin(baseSymbol)) {
      return { allowed: true };
    }

    const totalValue = assets.reduce((sum, a) => sum + a.usdValue, 0);

    if (totalValue <= 0) {
      return { allowed: true };
    }

    const { hard, soft } = this.resolveLimits(riskLevel, overrideLimit);

    const aggregated = this.aggregateByBaseSymbol(assets);
    const currentValue = aggregated.get(baseSymbol) ?? 0;
    const currentConcentration = currentValue / totalValue;

    // Already at or above hard limit → fully block
    if (currentConcentration >= hard) {
      return {
        allowed: false,
        reason: `${baseSymbol} concentration ${(currentConcentration * 100).toFixed(1)}% already at hard limit ${(hard * 100).toFixed(1)}%`
      };
    }

    // Calculate post-trade concentration
    const postTradeTotal = totalValue + tradeUsdValue;
    const postTradeValue = currentValue + tradeUsdValue;
    const postTradeConcentration = postTradeValue / postTradeTotal;

    // Would exceed hard limit → graceful reduction
    if (postTradeConcentration > hard) {
      const maxAdditionalUsd = this.calculateMaxAdditionalUsd(assets, baseSymbol, riskLevel, overrideLimit);

      if (maxAdditionalUsd <= 0) {
        return {
          allowed: false,
          reason: `${baseSymbol} trade would exceed hard limit ${(hard * 100).toFixed(1)}%; no room for additional allocation`
        };
      }

      const adjustedQuantity = maxAdditionalUsd / tradeUsdValue;

      return {
        allowed: true,
        adjustedQuantity: Math.min(adjustedQuantity, 1),
        reason: `${baseSymbol} trade reduced to ${(adjustedQuantity * 100).toFixed(1)}% to stay within hard limit ${(hard * 100).toFixed(1)}%`
      };
    }

    // Check soft limit warning
    if (postTradeConcentration > soft) {
      return {
        allowed: true,
        reason: `${baseSymbol} concentration warning: post-trade ${(postTradeConcentration * 100).toFixed(1)}% exceeds soft limit ${(soft * 100).toFixed(1)}%`
      };
    }

    return { allowed: true };
  }

  calculateMaxAdditionalUsd(
    assets: AssetAllocation[],
    targetSymbol: string,
    riskLevel: number,
    overrideLimit?: number | null
  ): number {
    const totalValue = assets.reduce((sum, a) => sum + a.usdValue, 0);

    if (totalValue <= 0) return 0;

    const { hard } = this.resolveLimits(riskLevel, overrideLimit);
    const baseSymbol = this.extractBaseSymbol(targetSymbol);
    const aggregated = this.aggregateByBaseSymbol(assets);
    const currentValue = aggregated.get(baseSymbol) ?? 0;

    // X = (hard * total - currentValue) / (1 - hard)
    const numerator = hard * totalValue - currentValue;
    const denominator = 1 - hard;

    if (denominator <= 0) return 0;

    return Math.max(0, numerator / denominator);
  }

  resolveLimits(riskLevel: number, overrideLimit?: number | null): { hard: number; soft: number } {
    if (overrideLimit != null && overrideLimit > 0) {
      const clamped = Math.min(Math.max(overrideLimit, 0.1), 0.8);
      return { hard: clamped, soft: Math.max(0, clamped - 0.05) };
    }

    return CONCENTRATION_LIMITS[riskLevel] ?? CONCENTRATION_LIMITS[3];
  }

  isStablecoin(symbol: string): boolean {
    return STABLECOIN_SYMBOLS.has(symbol.toUpperCase());
  }

  extractBaseSymbol(symbol: string): string {
    // Handle "BTC/USDT" → "BTC"
    const slash = symbol.indexOf('/');
    return slash >= 0 ? symbol.substring(0, slash).toUpperCase() : symbol.toUpperCase();
  }

  private aggregateByBaseSymbol(assets: AssetAllocation[]): Map<string, number> {
    const aggregated = new Map<string, number>();

    for (const asset of assets) {
      const base = this.extractBaseSymbol(asset.symbol);
      aggregated.set(base, (aggregated.get(base) ?? 0) + asset.usdValue);
    }

    return aggregated;
  }
}
