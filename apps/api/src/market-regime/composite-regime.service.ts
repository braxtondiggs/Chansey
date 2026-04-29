import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

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
import { NOTIFICATION_EVENTS } from '../notification/interfaces/notification-events.interface';
import { OHLCService } from '../ohlc/ohlc.service';
import { OHLCBackfillService } from '../ohlc/services/ohlc-backfill.service';
import { toErrorInfo } from '../shared/error.util';

/** Minimum data points required to compute the 200-period SMA */
const SMA_PERIOD = 200;
/** Slug for BTC — used to fetch daily close prices for 200-SMA */
const BTC_COIN_SLUG = 'bitcoin';
/** Redis key for persisting override state across restarts */
const OVERRIDE_CACHE_KEY = 'regime:override';
/** Override TTL — 24 hours (auto-expire as safety net) */
const OVERRIDE_TTL_MS = 86_400_000;
/** Staleness warning threshold — data older than this is reported as stale in getStatus() */
const STALE_WARNING_MS = 2 * 60 * 60 * 1000; // 2 hours
/** Staleness fallback threshold — return NEUTRAL instead of cached value after this duration */
const STALE_FALLBACK_MS = 4 * 60 * 60 * 1000; // 4 hours
/** Consecutive refresh failures before emitting a stale notification to admins */
const MAX_CONSECUTIVE_FAILURES = 3;

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
  private consecutiveFailures = 0;
  private staleNotificationEmitted = false;
  private staleLogEmitted = false;
  /** Per-coin composite regime cache, keyed by uppercase symbol. Reuses 4h fallback TTL. */
  private perCoinCache = new Map<string, CachedComposite>();
  /** Per-coin "no regime row yet" cache. Same 4h TTL as perCoinCache. */
  private perCoinCacheMisses = new Map<string, number>();

  constructor(
    private readonly marketRegimeService: MarketRegimeService,
    private readonly ohlcService: OHLCService,
    private readonly coinService: CoinService,
    private readonly auditService: AuditService,
    private readonly backfillService: OHLCBackfillService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly eventEmitter: EventEmitter2
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
   * Falls back to NEUTRAL if not yet calculated or if data is stale (>4 hours).
   */
  getCompositeRegime(): CompositeRegimeType {
    if (!this.cached) return CompositeRegimeType.NEUTRAL;

    const age = Date.now() - this.cached.updatedAt.getTime();
    if (age > STALE_FALLBACK_MS) {
      if (!this.staleLogEmitted) {
        this.staleLogEmitted = true;
        this.logger.warn(
          `Regime data stale (${Math.round(age / 60_000)}min since last refresh) — falling back to NEUTRAL`
        );
      }
      return CompositeRegimeType.NEUTRAL;
    }

    return this.cached.regime;
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
   * Cache age + staleness flag for the BTC-global composite. Used by the
   * regime fitness gate to decide ALLOW_STALE.
   */
  getCacheStatus(): { stale: boolean; ageMs: number } {
    if (!this.cached) return { stale: true, ageMs: Number.MAX_SAFE_INTEGER };
    const ageMs = Date.now() - this.cached.updatedAt.getTime();
    return { stale: ageMs > STALE_FALLBACK_MS, ageMs };
  }

  /**
   * Per-coin composite regime: combines the coin's volatility regime with the
   * BTC-global trend filter. The trend filter is a macro signal, so it applies
   * to every coin regardless of which asset's volatility we're combining.
   *
   * Falls back to the BTC-global composite when:
   *   - the symbol is BTC (short-circuit)
   *   - no `market_regimes` row exists yet for the coin
   *   - any error occurs during lookup (fail-open)
   *
   * Cached entries within 4h are returned without re-querying.
   */
  async getCompositeRegimeForCoin(symbol: string): Promise<CompositeRegimeType> {
    const upper = symbol.toUpperCase();
    if (upper === 'BTC') return this.getCompositeRegime();

    const existing = this.perCoinCache.get(upper);
    if (existing && Date.now() - existing.updatedAt.getTime() < STALE_FALLBACK_MS) {
      return existing.regime;
    }

    const missAt = this.perCoinCacheMisses.get(upper);
    if (missAt) {
      if (Date.now() - missAt < STALE_FALLBACK_MS) {
        return this.getCompositeRegime();
      }
      this.perCoinCacheMisses.delete(upper);
    }

    try {
      const coinRegime = await this.marketRegimeService.getCurrentRegime(upper);
      if (!coinRegime) {
        this.perCoinCacheMisses.set(upper, Date.now());
        return this.getCompositeRegime();
      }
      const trendAboveSma = this.getTrendAboveSma();
      const composite = this.classify(coinRegime.regime, trendAboveSma);

      this.perCoinCache.set(upper, {
        regime: composite,
        volatilityRegime: coinRegime.regime,
        trendAboveSma,
        btcPrice: this.cached?.btcPrice ?? 0,
        sma200Value: this.cached?.sma200Value ?? 0,
        updatedAt: new Date()
      });
      this.perCoinCacheMisses.delete(upper);
      return composite;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Per-coin composite for ${upper} failed: ${err.message}`);
      return this.getCompositeRegime();
    }
  }

  /**
   * Per-coin volatility regime — the underlying `MarketRegimeType` used to
   * compute the composite. Returns null when no data is available so callers
   * can decide between fallback strategies.
   *
   * Reads from the per-coin cache populated by `getCompositeRegimeForCoin`.
   * For BTC, returns the global cached volatility regime.
   */
  getVolatilityRegimeForCoin(symbol: string): MarketRegimeType | null {
    const upper = symbol.toUpperCase();
    if (upper === 'BTC') return this.cached?.volatilityRegime ?? null;
    return this.perCoinCache.get(upper)?.volatilityRegime ?? null;
  }

  /**
   * Recalculate and cache the composite regime.
   * Called hourly by MarketRegimeTask after volatility detection.
   */
  async refresh(): Promise<CompositeRegimeType> {
    try {
      // 1. Fetch BTC daily prices from local OHLC candles (1y ≈ 365 data points, well above 200)
      const btcCoin = await this.coinService.getCoinBySlug(BTC_COIN_SLUG);
      if (!btcCoin) {
        this.logger.warn('BTC coin not found in database — keeping previous regime');
        this.trackFailure();
        return this.getCompositeRegime();
      }

      const summaries = await this.ohlcService.findAllByDay(btcCoin.id, '1y');
      const coinSummaries = summaries[btcCoin.id];

      // findAllByDay returns descending order — reverse to chronological
      const closes = (coinSummaries ?? [])
        .map((s) => s.close)
        .filter((v): v is number => Number.isFinite(v))
        .reverse();

      if (closes.length < SMA_PERIOD) {
        this.logger.warn(
          `Only ${closes.length} BTC price points available (need ${SMA_PERIOD}) — keeping previous regime`
        );
        this.trackFailure();
        void this.triggerBackfillIfNeeded(btcCoin.id);
        return this.getCompositeRegime();
      }

      // 2. Compute 200-period SMA
      const smaValues = SMA.calculate({ period: SMA_PERIOD, values: closes });
      const sma200 = smaValues[smaValues.length - 1];
      const btcPrice = closes[closes.length - 1];

      if (!Number.isFinite(sma200) || !Number.isFinite(btcPrice)) {
        this.logger.warn(`Invalid SMA/price values (sma200=${sma200}, btcPrice=${btcPrice}) — keeping previous regime`);
        this.trackFailure();
        return this.getCompositeRegime();
      }

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

      this.consecutiveFailures = 0;
      this.staleNotificationEmitted = false;
      this.staleLogEmitted = false;

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
      this.trackFailure();
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
    isStale: boolean;
    consecutiveFailures: number;
    lastSuccessfulRefresh: Date | null;
    override: { active: boolean; forceAllow?: boolean; userId?: string; reason?: string; enabledAt?: Date };
  } {
    const age = this.cached ? Date.now() - this.cached.updatedAt.getTime() : 0;
    const isStale = this.cached !== null && age > STALE_WARNING_MS;

    return {
      compositeRegime: this.getCompositeRegime(),
      volatilityRegime: this.cached?.volatilityRegime ?? null,
      trendAboveSma: this.cached?.trendAboveSma ?? null,
      btcPrice: this.cached?.btcPrice ?? null,
      sma200Value: this.cached?.sma200Value ?? null,
      updatedAt: this.cached?.updatedAt ?? null,
      isStale,
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessfulRefresh: this.cached?.updatedAt ?? null,
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

  private trackFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !this.staleNotificationEmitted) {
      this.staleNotificationEmitted = true;
      this.logger.error(
        `Market regime refresh failed ${this.consecutiveFailures} consecutive times — emitting stale notification`
      );
      this.eventEmitter.emit(NOTIFICATION_EVENTS.REGIME_STALE, {
        lastRefreshAt: this.cached?.updatedAt ?? null,
        consecutiveFailures: this.consecutiveFailures,
        cachedRegime: this.cached?.regime ?? 'NONE'
      });
    }
  }

  /**
   * Fire-and-forget BTC OHLC backfill when insufficient data is available.
   * Skips if a backfill is already pending, in progress, failed, or recently
   * completed (Redis TTL acts as a 7-day cooldown).
   */
  private async triggerBackfillIfNeeded(coinId: string): Promise<void> {
    try {
      const progress = await this.backfillService.getProgress(coinId);

      if (
        progress &&
        (progress.status === 'pending' ||
          progress.status === 'in_progress' ||
          progress.status === 'failed' ||
          progress.status === 'completed')
      ) {
        this.logger.debug(`BTC backfill already ${progress.status} — skipping trigger`);
        return;
      }

      this.logger.log('Triggering BTC OHLC backfill to gather sufficient data for 200-day SMA');
      this.backfillService.startBackfill(coinId).catch((err: unknown) => {
        const info = toErrorInfo(err);
        this.logger.warn(`BTC backfill trigger failed: ${info.message}`);
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to check backfill progress: ${err.message}`);
    }
  }
}
