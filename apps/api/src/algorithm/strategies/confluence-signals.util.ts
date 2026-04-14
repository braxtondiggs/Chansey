import { type ExitConfig, StopLossType, TakeProfitType } from '../../order/interfaces/exit-config.interface';
import { type ConfluenceConfig, type ConfluenceScore, SignalType, type TradingSignal } from '../interfaces';

/**
 * Generate trading signal from confluence score.
 *
 * When `isFuturesShort` is true (enableShortSignals + futures marketType):
 * - Bearish confluence emits SHORT_ENTRY instead of SELL
 * - Bullish confluence emits SHORT_EXIT in addition to BUY (to close any open short)
 *
 * Returns a single signal or null. When a bullish confluence triggers both BUY
 * and SHORT_EXIT, SHORT_EXIT is returned (closing a short is higher priority);
 * the caller can still generate a BUY on the next evaluation cycle.
 */
export function generateSignalFromConfluence(
  coinId: string,
  coinSymbol: string,
  price: number,
  confluenceScore: ConfluenceScore,
  config: ConfluenceConfig,
  isFuturesShort = false
): TradingSignal | null {
  if (confluenceScore.direction === 'hold') {
    return null;
  }

  const strength = calculateSignalStrength(confluenceScore);
  const confidence = calculateConfidence(confluenceScore, config);

  if (confidence < config.minConfidence) {
    return null;
  }

  // Determine signal type based on direction and futures short mode
  let signalType: SignalType;
  if (confluenceScore.direction === 'buy') {
    // Bullish confluence: in futures short mode, emit SHORT_EXIT to close any open short
    signalType = isFuturesShort ? SignalType.SHORT_EXIT : SignalType.BUY;
  } else {
    // Bearish confluence: in futures short mode, emit SHORT_ENTRY instead of SELL
    signalType = isFuturesShort ? SignalType.SHORT_ENTRY : SignalType.SELL;
  }

  // Build detailed reason from individual signals
  const agreeingIndicators = confluenceScore.signals
    .filter(
      (s) =>
        (confluenceScore.direction === 'buy' && s.signal === 'bullish') ||
        (confluenceScore.direction === 'sell' && s.signal === 'bearish')
    )
    .map((s) => s.name);

  const reason = `Confluence ${signalType}: ${confluenceScore.confluenceCount}/${confluenceScore.totalEnabled} indicators agree (${agreeingIndicators.join(', ')})`;

  // Extract ATR value from indicator signals if available
  const atrSignal = confluenceScore.signals.find((s) => s.name === 'ATR');
  const rawAtr = atrSignal?.values?.atr;
  const currentAtr = typeof rawAtr === 'number' && Number.isFinite(rawAtr) && rawAtr > 0 ? rawAtr : undefined;

  // Build metadata from all indicator values
  const metadata: Record<string, unknown> = {
    symbol: coinSymbol,
    confluenceCount: confluenceScore.confluenceCount,
    totalEnabled: confluenceScore.totalEnabled,
    agreeingIndicators,
    isVolatilityFiltered: confluenceScore.isVolatilityFiltered,
    isFuturesShort,
    currentAtr,
    indicatorBreakdown: confluenceScore.signals.map((s) => ({
      name: s.name,
      signal: s.signal,
      strength: s.strength,
      reason: s.reason,
      values: s.values
    }))
  };

  return {
    type: signalType,
    coinId,
    strength,
    price,
    confidence,
    reason,
    metadata,
    exitConfig: buildExitConfig(confluenceScore, currentAtr)
  };
}

/**
 * Build strategy-specific exit configuration scaled by confluence score.
 * Higher confluence → tighter stops and wider take-profit (more confident trade).
 *
 * When ATR is available, uses ATR-based stop loss (1.5x-2.5x ATR multiplier)
 * to adapt to actual market volatility instead of fixed percentages.
 * When ATR is unavailable, falls back to wider percentage stops (5-8%)
 * to avoid triggering on normal crypto volatility.
 */
export function buildExitConfig(confluenceScore: ConfluenceScore, currentAtr?: number): Partial<ExitConfig> {
  const ratio = confluenceScore.totalEnabled > 0 ? confluenceScore.confluenceCount / confluenceScore.totalEnabled : 0.5;

  // Take profit: 1.5:1 to 3:1 risk-reward scaled by confluence
  const takeProfitRR = Math.max(1, 1.5 + ratio * 1.5); // ratio=1 → 3:1, ratio=0.4 → 2.1:1

  if (currentAtr != null && currentAtr > 0) {
    // ATR-based stop loss: 1.5x-2.5x ATR multiplier (tighter for higher confluence)
    const stopLossValue = 2.5 - ratio * 1.0; // ratio=1 → 1.5x, ratio=0.4 → 2.1x

    return {
      enableStopLoss: true,
      stopLossType: StopLossType.ATR,
      stopLossValue,
      enableTakeProfit: true,
      takeProfitType: TakeProfitType.RISK_REWARD,
      takeProfitValue: takeProfitRR,
      enableTrailingStop: false,
      useOco: true
    };
  }

  // Fallback: wider percentage stops (5-8%) to survive crypto volatility
  const stopLossValue = Math.max(5, 8 - ratio * 3); // ratio=1 → 5%, ratio=0.4 → 6.8%

  return {
    enableStopLoss: true,
    stopLossType: StopLossType.PERCENTAGE,
    stopLossValue,
    enableTakeProfit: true,
    takeProfitType: TakeProfitType.RISK_REWARD,
    takeProfitValue: takeProfitRR,
    enableTrailingStop: false,
    useOco: true
  };
}

/**
 * Calculate signal strength from confluence score
 */
export function calculateSignalStrength(confluenceScore: ConfluenceScore): number {
  // Strength based on:
  // 1. Average strength of agreeing indicators
  // 2. Confluence ratio (how many agree vs total)
  const confluenceRatio =
    confluenceScore.totalEnabled > 0 ? confluenceScore.confluenceCount / confluenceScore.totalEnabled : 0;

  return Math.min(1, confluenceScore.averageStrength * 0.6 + confluenceRatio * 0.4);
}

/**
 * Calculate confidence from confluence score
 */
export function calculateConfidence(confluenceScore: ConfluenceScore, config: ConfluenceConfig): number {
  // Base confidence from confluence level
  const confluenceRatio =
    confluenceScore.totalEnabled > 0 ? confluenceScore.confluenceCount / confluenceScore.totalEnabled : 0;
  const baseConfidence = 0.4 + confluenceRatio * 0.4; // 40% base + up to 40% from confluence

  // Bonus for exceeding the direction-specific minimum confluence
  const minRequired = confluenceScore.direction === 'sell' ? config.minSellConfluence : config.minConfluence;
  const excessConfluence = Math.max(0, confluenceScore.confluenceCount - minRequired);
  const confluenceBonus = excessConfluence * 0.1; // 10% per extra agreeing indicator

  // Strength contribution
  const strengthBonus = confluenceScore.averageStrength * 0.2; // Up to 20% from strength

  return Math.min(1, baseConfidence + confluenceBonus + strengthBonus);
}
