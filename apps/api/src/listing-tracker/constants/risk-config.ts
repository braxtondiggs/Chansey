/**
 * Listing Tracker — Risk-Level Configuration
 *
 * Controls position sizing, exits, and time-stops for the two listing
 * strategies (Cross-Listing Sniper and Post-Announcement Momentum), plus the
 * optional Kraken Futures spot-leg hedge.
 *
 * Only risk 4 and 5 can access listing strategies. Risk 5 additionally unlocks
 * the post-announcement leg and the hedge.
 */

export interface ListingStrategyConfig {
  /** Portfolio allocation per trade, in percent */
  positionSizePct: number;
  /** Max simultaneous listing positions in this mode */
  maxConcurrent: number;
  /** Stop-loss distance, in percent from entry */
  stopLossPct: number;
  /** Take-profit ladder (percent gains at which partial TP legs sit) */
  takeProfitLadder: number[];
  /** Trailing-stop activation threshold, in percent */
  trailingStopActivationPct: number;
  /** Trailing-stop distance, in percent */
  trailingStopPct: number;
  /** Hard time-stop in days (pre-listing) */
  timeStopDays?: number;
  /** Hard time-stop in hours (post-announcement) */
  timeStopHours?: number;
}

export interface ListingHedgeConfig {
  enabled: boolean;
  requiresKrakenFutures: boolean;
  /** Hedge size as a fraction of spot quantity (e.g. 0.4 = 40%) */
  sizePct: number;
  leverage: number;
  autoCloseOnSpotExit: boolean;
}

export interface ListingRiskLevelConfig {
  preListing: ListingStrategyConfig | null;
  postAnnouncement: ListingStrategyConfig | null;
  hedge: ListingHedgeConfig | null;
}

export const LISTING_RISK_CONFIG: Record<number, ListingRiskLevelConfig> = {
  4: {
    preListing: {
      positionSizePct: 2.5,
      maxConcurrent: 2,
      stopLossPct: 18,
      takeProfitLadder: [30, 60, 100],
      trailingStopActivationPct: 20,
      trailingStopPct: 10,
      timeStopDays: 30
    },
    postAnnouncement: null,
    hedge: null
  },
  5: {
    preListing: {
      positionSizePct: 3,
      maxConcurrent: 3,
      stopLossPct: 15,
      takeProfitLadder: [30, 60, 100],
      trailingStopActivationPct: 20,
      trailingStopPct: 10,
      timeStopDays: 30
    },
    postAnnouncement: {
      positionSizePct: 4,
      maxConcurrent: 5,
      stopLossPct: 10,
      takeProfitLadder: [15, 30],
      trailingStopActivationPct: 15,
      trailingStopPct: 7,
      timeStopHours: 48
    },
    hedge: {
      enabled: true,
      requiresKrakenFutures: true,
      sizePct: 0.4,
      leverage: 3,
      autoCloseOnSpotExit: true
    }
  }
};

export function getListingRiskConfig(riskLevel: number): ListingRiskLevelConfig | null {
  return LISTING_RISK_CONFIG[riskLevel] ?? null;
}

export function resolveExpiryDate(config: ListingStrategyConfig, from: Date = new Date()): Date {
  const ms =
    config.timeStopDays != null
      ? config.timeStopDays * 24 * 60 * 60 * 1000
      : (config.timeStopHours ?? 0) * 60 * 60 * 1000;
  return new Date(from.getTime() + ms);
}

export const LISTING_STRATEGY_NAMES = {
  PRE_LISTING: 'cross-listing-sniper',
  POST_ANNOUNCEMENT: 'post-announcement-momentum'
} as const;
