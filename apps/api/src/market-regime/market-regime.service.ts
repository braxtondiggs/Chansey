import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import {
  DEFAULT_VOLATILITY_CONFIG,
  MarketRegimeType,
  REGIME_THRESHOLDS,
  VolatilityConfig
} from '@chansey/api-interfaces';

import { MarketRegime } from './entities/market-regime.entity';
import { RegimeChangeDetector } from './regime-change.detector';
import { VolatilityCalculator } from './volatility.calculator';

/**
 * Market Regime Service
 * Detects and tracks market regimes based on volatility percentiles
 */
@Injectable()
export class MarketRegimeService {
  private readonly logger = new Logger(MarketRegimeService.name);

  constructor(
    @InjectRepository(MarketRegime)
    private readonly marketRegimeRepo: Repository<MarketRegime>,
    private readonly volatilityCalculator: VolatilityCalculator,
    private readonly regimeChangeDetector: RegimeChangeDetector
  ) {}

  /**
   * Detect current market regime for an asset
   */
  async detectRegime(
    asset: string,
    priceData: number[],
    config: VolatilityConfig = DEFAULT_VOLATILITY_CONFIG
  ): Promise<MarketRegime> {
    // Calculate realized volatility
    const volatility = this.volatilityCalculator.calculateRealizedVolatility(priceData, config);

    // Calculate historical percentile
    const percentile = this.volatilityCalculator.calculatePercentile(volatility, priceData, config);

    // Determine regime from percentile
    const regime = this.determineRegime(percentile);

    // Get current active regime
    const currentRegime = await this.getCurrentRegime(asset);

    // Check if regime changed
    if (currentRegime && currentRegime.regime !== regime) {
      // Regime change detected
      await this.handleRegimeChange(currentRegime, regime, asset, volatility, percentile, config);
    } else if (!currentRegime) {
      // First regime detection for this asset
      await this.createRegime(asset, regime, volatility, percentile, config);
    }

    // Return current regime
    const finalRegime = await this.getCurrentRegime(asset);
    if (!finalRegime) {
      throw new Error(`Failed to detect or create market regime for ${asset}`);
    }
    return finalRegime;
  }

  /**
   * Get current active regime for asset
   */
  async getCurrentRegime(asset: string): Promise<MarketRegime | null> {
    return this.marketRegimeRepo.findOne({
      where: { asset, effectiveUntil: IsNull() },
      order: { detectedAt: 'DESC' }
    });
  }

  /**
   * Get regime history for asset
   */
  async getRegimeHistory(asset: string, limit = 50): Promise<MarketRegime[]> {
    return this.marketRegimeRepo.find({
      where: { asset },
      order: { detectedAt: 'DESC' },
      take: limit
    });
  }

  /**
   * Determine regime type from volatility percentile
   */
  private determineRegime(percentile: number): MarketRegimeType {
    if (percentile >= REGIME_THRESHOLDS[MarketRegimeType.EXTREME].min) {
      return MarketRegimeType.EXTREME;
    } else if (percentile >= REGIME_THRESHOLDS[MarketRegimeType.HIGH_VOLATILITY].min) {
      return MarketRegimeType.HIGH_VOLATILITY;
    } else if (percentile >= REGIME_THRESHOLDS[MarketRegimeType.NORMAL].min) {
      return MarketRegimeType.NORMAL;
    } else {
      return MarketRegimeType.LOW_VOLATILITY;
    }
  }

  /**
   * Handle regime change
   */
  private async handleRegimeChange(
    currentRegime: MarketRegime,
    newRegime: MarketRegimeType,
    asset: string,
    volatility: number,
    percentile: number,
    config: VolatilityConfig
  ): Promise<void> {
    // Close current regime
    currentRegime.effectiveUntil = new Date();
    await this.marketRegimeRepo.save(currentRegime);

    // Create new regime
    await this.createRegime(asset, newRegime, volatility, percentile, config, currentRegime.id);

    // Detect regime change impact
    const impact = await this.regimeChangeDetector.detectImpact(currentRegime.regime, newRegime, asset);

    this.logger.warn(
      `Regime change detected for ${asset}: ${currentRegime.regime} → ${newRegime} (Severity: ${impact.severity})`
    );

    // Log affected strategies
    if (impact.affectedStrategies.length > 0) {
      this.logger.warn(`${impact.affectedStrategies.length} strategies affected by regime change`);
    }
  }

  /**
   * Create new regime entry
   */
  private async createRegime(
    asset: string,
    regime: MarketRegimeType,
    volatility: number,
    percentile: number,
    config: VolatilityConfig,
    previousRegimeId?: string
  ): Promise<MarketRegime> {
    const marketRegime = this.marketRegimeRepo.create({
      asset,
      regime,
      volatility,
      percentile,
      previousRegimeId,
      metadata: {
        calculationMethod: `${config.rollingDays}-day-rolling-${config.method}`,
        lookbackDays: config.lookbackDays,
        dataPoints: config.lookbackDays
      }
    });

    const saved = await this.marketRegimeRepo.save(marketRegime);

    this.logger.log(`New regime detected for ${asset}: ${regime} (${percentile.toFixed(1)}th percentile)`);

    return saved;
  }

  /**
   * Get regime statistics
   */
  async getRegimeStats(
    asset: string,
    days = 365
  ): Promise<{
    regimeCounts: Record<MarketRegimeType, number>;
    avgVolatility: number;
    regimeTransitions: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const regimes = await this.marketRegimeRepo.find({
      where: { asset },
      order: { detectedAt: 'DESC' }
    });

    const regimeCounts: Record<MarketRegimeType, number> = {
      [MarketRegimeType.LOW_VOLATILITY]: 0,
      [MarketRegimeType.NORMAL]: 0,
      [MarketRegimeType.HIGH_VOLATILITY]: 0,
      [MarketRegimeType.EXTREME]: 0
    };

    let totalVolatility = 0;

    for (const regime of regimes) {
      regimeCounts[regime.regime]++;
      totalVolatility += parseFloat(regime.volatility.toString());
    }

    return {
      regimeCounts,
      avgVolatility: regimes.length > 0 ? totalVolatility / regimes.length : 0,
      regimeTransitions: regimes.length - 1
    };
  }

  /**
   * Check if in high volatility regime
   */
  async isHighVolatilityRegime(asset: string): Promise<boolean> {
    const current = await this.getCurrentRegime(asset);
    if (!current) return false;

    return current.regime === MarketRegimeType.HIGH_VOLATILITY || current.regime === MarketRegimeType.EXTREME;
  }
}
