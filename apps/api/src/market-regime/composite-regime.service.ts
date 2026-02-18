import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { Cache } from 'cache-manager';
import { SMA } from 'technicalindicators';

import {
  AuditEventType,
  classifyCompositeRegime,
  CompositeRegimeType,
  MarketRegimeType
} from '@chansey/api-interfaces';

import { MarketRegimeService } from './market-regime.service';

import { AuditService } from '../audit/audit.service';
import { CoinService } from '../coin/coin.service';
import { toErrorInfo } from '../shared/error.util';

/** Minimum data points required to compute the 200-period SMA */
const SMA_PERIOD = 200;
/** CoinGecko slug for BTC — used to fetch daily close prices for 200-SMA */
const BTC_COIN_SLUG = 'bitcoin';
/** Redis key for persisting override state across restarts */
const OVERRIDE_CACHE_KEY = 'regime:override';
/** Override TTL — 24 hours (auto-expire as safety net) */
const OVERRIDE_TTL_MS = 86_400_000;

interface OverrideState {
  active: boolean;
  forceAllow: boolean;
  userId: string;
  reason: string;
  enabledAt: Date;
}

interface CachedComposite {
  regime: CompositeRegimeType;
  volatilityRegime: MarketRegimeType;
  trendAboveSma: boolean;
  btcPrice: number;
  sma200Value: number;
  updatedAt: Date;
}

/**
 * Combines volatility regime (from MarketRegimeService) with a BTC trend filter
 * (price vs 200-day SMA) to produce a composite regime.
 *
 * The composite is cached in memory and refreshed hourly by MarketRegimeTask.
 */
@Injectable()
export class CompositeRegimeService implements OnModuleInit {
  private readonly logger = new Logger(CompositeRegimeService.name);
  private cached: CachedComposite | null = null;
  private override: OverrideState | null = null;

  constructor(
    private readonly marketRegimeService: MarketRegimeService,
    private readonly coinService: CoinService,
    private readonly auditService: AuditService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const saved = await this.cacheManager.get<OverrideState>(OVERRIDE_CACHE_KEY);
      if (saved?.active) {
        this.override = saved;
        this.logger.log(`Restored regime override from Redis (user=${saved.userId})`);
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to restore override from Redis: ${err.message}`);
    }

    try {
      await this.refresh();
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Initial composite regime refresh failed — will retry on next hourly cycle: ${err.message}`);
    }
  }

  /**
   * Synchronous getter for the hot path. Returns cached composite regime.
   * Falls back to NEUTRAL if not yet calculated.
   */
  getCompositeRegime(): CompositeRegimeType {
    return this.cached?.regime ?? CompositeRegimeType.NEUTRAL;
  }

  /**
   * Synchronous getter for the cached volatility regime.
   * Falls back to NORMAL if not yet calculated.
   */
  getVolatilityRegime(): MarketRegimeType {
    return this.cached?.volatilityRegime ?? MarketRegimeType.NORMAL;
  }

  /**
   * Synchronous getter for the cached BTC trend flag.
   * Falls back to true (optimistic) if not yet calculated.
   */
  getTrendAboveSma(): boolean {
    return this.cached?.trendAboveSma ?? true;
  }

  /**
   * Whether the manual override is currently active.
   */
  isOverrideActive(): boolean {
    return this.override?.active ?? false;
  }

  /**
   * Recalculate and cache the composite regime.
   * Called hourly by MarketRegimeTask after volatility detection.
   */
  async refresh(): Promise<CompositeRegimeType> {
    try {
      // 1. Fetch BTC daily prices (1y ≈ 365 data points, well above 200)
      const chartData = await this.coinService.getMarketChart(BTC_COIN_SLUG, '1y');
      const closes = chartData.prices.map((p) => p.price);

      if (closes.length < SMA_PERIOD) {
        this.logger.warn(
          `Only ${closes.length} BTC price points available (need ${SMA_PERIOD}) — keeping previous regime`
        );
        return this.getCompositeRegime();
      }

      // 2. Compute 200-period SMA
      const smaValues = SMA.calculate({ period: SMA_PERIOD, values: closes });
      const sma200 = smaValues[smaValues.length - 1];
      const btcPrice = closes[closes.length - 1];
      const trendAboveSma = btcPrice > sma200;

      // 3. Get current volatility regime for BTC
      const btcRegime = await this.marketRegimeService.getCurrentRegime('BTC');
      const volatilityRegime = btcRegime?.regime ?? MarketRegimeType.NORMAL;

      // 4. Classify composite
      const composite = this.classify(volatilityRegime, trendAboveSma);

      const previous = this.cached?.regime;
      this.cached = {
        regime: composite,
        volatilityRegime,
        trendAboveSma,
        btcPrice,
        sma200Value: sma200,
        updatedAt: new Date()
      };

      if (previous && previous !== composite) {
        this.logger.warn(`Composite regime changed: ${previous} → ${composite}`);
      } else {
        this.logger.log(
          `Composite regime: ${composite} (BTC $${btcPrice.toFixed(0)} vs SMA200 $${sma200.toFixed(0)}, vol=${volatilityRegime})`
        );
      }

      return composite;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to refresh composite regime: ${err.message}`);
      throw error;
    }
  }

  /**
   * Pure classification logic — delegates to shared utility.
   */
  classify(volatilityRegime: MarketRegimeType, trendAboveSma: boolean): CompositeRegimeType {
    return classifyCompositeRegime(volatilityRegime, trendAboveSma);
  }

  /**
   * Enable manual override to force-allow all signals regardless of regime.
   */
  async enableOverride(userId: string, forceAllow: boolean, reason: string): Promise<void> {
    this.override = {
      active: true,
      forceAllow,
      userId,
      reason,
      enabledAt: new Date()
    };

    await this.cacheManager.set(OVERRIDE_CACHE_KEY, this.override, OVERRIDE_TTL_MS);

    await this.auditService.createAuditLog({
      eventType: AuditEventType.MANUAL_INTERVENTION,
      entityType: 'CompositeRegime',
      entityId: 'override',
      userId,
      afterState: { forceAllow, reason },
      metadata: { action: 'enable_regime_override' }
    });

    this.logger.warn(`Regime gate override ENABLED by ${userId}: forceAllow=${forceAllow}, reason="${reason}"`);
  }

  /**
   * Disable manual override — resume normal regime gating.
   */
  async disableOverride(userId: string, reason: string): Promise<void> {
    const previous = this.override;
    this.override = null;

    await this.cacheManager.del(OVERRIDE_CACHE_KEY);

    await this.auditService.createAuditLog({
      eventType: AuditEventType.MANUAL_INTERVENTION,
      entityType: 'CompositeRegime',
      entityId: 'override',
      userId,
      beforeState: previous ? { forceAllow: previous.forceAllow, reason: previous.reason } : undefined,
      afterState: { active: false, reason },
      metadata: { action: 'disable_regime_override' }
    });

    this.logger.warn(`Regime gate override DISABLED by ${userId}: reason="${reason}"`);
  }

  /**
   * Status payload for admin API endpoint.
   */
  getStatus(): {
    compositeRegime: CompositeRegimeType;
    volatilityRegime: MarketRegimeType | null;
    trendAboveSma: boolean | null;
    btcPrice: number | null;
    sma200Value: number | null;
    updatedAt: Date | null;
    override: { active: boolean; forceAllow?: boolean; userId?: string; reason?: string; enabledAt?: Date };
  } {
    return {
      compositeRegime: this.getCompositeRegime(),
      volatilityRegime: this.cached?.volatilityRegime ?? null,
      trendAboveSma: this.cached?.trendAboveSma ?? null,
      btcPrice: this.cached?.btcPrice ?? null,
      sma200Value: this.cached?.sma200Value ?? null,
      updatedAt: this.cached?.updatedAt ?? null,
      override: this.override
        ? {
            active: true,
            forceAllow: this.override.forceAllow,
            userId: this.override.userId,
            reason: this.override.reason,
            enabledAt: this.override.enabledAt
          }
        : { active: false }
    };
  }
}
