import { PipelineStage } from '@chansey/api-interfaces';

import { SignalType as AlgoSignalType, TradingSignal as StrategySignal } from '../../../../algorithm/interfaces';
import { ExitConfig } from '../../../interfaces/exit-config.interface';
import { OpportunitySellingUserConfig } from '../../../interfaces/opportunity-selling.interface';
import { BacktestCheckpointState } from '../../backtest-checkpoint.interface';
import { CheckpointResults, LiveReplayExecuteOptions } from '../../backtest-pacing.interface';
import { SignalType } from '../../backtest-signal.entity';
import { MarketDataSet } from '../../market-data-set.entity';
import { TradingSignal } from '../types';

export interface ExecuteOptions {
  dataset: MarketDataSet;
  deterministicSeed: string;
  telemetryEnabled?: boolean;

  /** Minimum time a position must be held before selling (ms). Default: 24h.
   *  Risk-control signals (STOP_LOSS, TAKE_PROFIT) always bypass this. */
  minHoldMs?: number;

  /** Enable opportunity-based selling for this backtest run (default: false) */
  enableOpportunitySelling?: boolean;
  /** Opportunity selling configuration (uses DEFAULT_OPPORTUNITY_SELLING_CONFIG if not provided) */
  opportunitySellingConfig?: OpportunitySellingUserConfig;

  /** Maximum allocation per trade as fraction of portfolio (0-1). Overrides stage/risk defaults. */
  maxAllocation?: number;
  /** Minimum allocation per trade as fraction of portfolio (0-1). Overrides stage/risk defaults. */
  minAllocation?: number;

  /** Pipeline stage for allocation limit lookup (default: HISTORICAL) */
  pipelineStage?: PipelineStage;

  /** Enable mandatory hard stop-loss for all positions (default: true) */
  enableHardStopLoss?: boolean;
  /** Hard stop-loss threshold as a fraction (0-1). Default: 0.05 (5% loss triggers exit) */
  hardStopLossPercent?: number;

  /** Exit configuration for SL/TP/trailing stop simulation (overrides legacy hard stop-loss when provided) */
  exitConfig?: ExitConfig;

  /** Enable composite regime gate filtering (default: true).
   *  When enabled, BUY signals are blocked when BTC is below its 200-day SMA. */
  enableRegimeGate?: boolean;

  /** Enable regime-scaled position sizing (default: true to match live trading) */
  enableRegimeScaledSizing?: boolean;
  /** User risk level for regime multiplier lookup (1-5). Default: 3 */
  riskLevel?: number;

  // Checkpoint options for resume capability
  /** Number of timestamps between checkpoints (default: 500) */
  checkpointInterval?: number;
  /** Callback invoked at each checkpoint with current state and total timestamp count */
  onCheckpoint?: (state: BacktestCheckpointState, results: CheckpointResults, totalTimestamps: number) => Promise<void>;
  /** Lightweight callback for progress updates (called at most every ~30 seconds) */
  onHeartbeat?: (index: number, totalTimestamps: number) => Promise<void>;
  /** Checkpoint state to resume from (if resuming a previous run) */
  resumeFrom?: BacktestCheckpointState;

  /** Market type: 'spot' (default) or 'futures' */
  marketType?: string;
  /** Leverage multiplier for futures trading (default: 1) */
  leverage?: number;

  /** AbortSignal from ShutdownSignalService — checked at yield points to trigger emergency checkpoint */
  abortSignal?: AbortSignal;

  /** Enable forced exit when a coin is delisted mid-backtest (default: true) */
  enableDelistingExit?: boolean;
  /** Delisting penalty as a fraction (0-1). Default: 0.90 meaning 90% loss (position closed at 10% of last price) */
  delistingPenalty?: number;
}

/** Unified options for both historical and live-replay execution modes. */
export type LoopRunnerOptions = (ExecuteOptions | LiveReplayExecuteOptions) & {
  mode: 'historical' | 'live-replay';
};

// ---- Standalone helper functions ----

export const mapStrategySignal = (signal: StrategySignal, resultExitConfig?: Partial<ExitConfig>): TradingSignal => {
  let action: TradingSignal['action'];
  switch (signal.type) {
    case AlgoSignalType.BUY:
      action = 'BUY';
      break;
    case AlgoSignalType.SELL:
    case AlgoSignalType.STOP_LOSS:
    case AlgoSignalType.TAKE_PROFIT:
      action = 'SELL';
      break;
    case AlgoSignalType.SHORT_ENTRY:
      action = 'OPEN_SHORT';
      break;
    case AlgoSignalType.SHORT_EXIT:
      action = 'CLOSE_SHORT';
      break;
    default:
      action = 'HOLD';
  }

  // Per-signal exitConfig takes priority over result-level exitConfig
  const exitConfig = signal.exitConfig ?? resultExitConfig;

  return {
    action,
    coinId: signal.coinId,
    quantity: signal.quantity,
    percentage: signal.strength,
    reason: signal.reason,
    confidence: signal.confidence,
    metadata: signal.metadata,
    originalType: signal.type,
    exitConfig
  };
};

export const classifySignalType = (signal: TradingSignal): SignalType => {
  if (signal.originalType === AlgoSignalType.STOP_LOSS || signal.originalType === AlgoSignalType.TAKE_PROFIT) {
    return SignalType.RISK_CONTROL;
  }
  if (signal.action === 'BUY' || signal.action === 'OPEN_SHORT') return SignalType.ENTRY;
  if (signal.action === 'SELL' || signal.action === 'CLOSE_SHORT') return SignalType.EXIT;
  return SignalType.ADJUSTMENT;
};
