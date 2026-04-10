import { SignalType as AlgoSignalType } from '../../../../algorithm/interfaces';
import { ExitConfig } from '../../../interfaces/exit-config.interface';

export interface MarketData {
  timestamp: Date;
  prices: Map<string, number>; // coinId -> price
}

export interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD' | 'OPEN_SHORT' | 'CLOSE_SHORT';
  coinId: string;
  quantity?: number;
  percentage?: number;
  reason: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
  /** Preserves the original algorithm signal type (e.g. STOP_LOSS, TAKE_PROFIT) */
  originalType?: AlgoSignalType;
  /** Strategy-provided exit configuration (per-signal > result-level) */
  exitConfig?: Partial<ExitConfig>;
}
