export * from './lib/admin/backtest-monitoring.interface';
export * from './lib/admin/trading-state.interface';
export * from './lib/algorithm/algorithm.interface';
export * from './lib/api-interfaces';
export * from './lib/audit/audit-entry.interface';
export * from './lib/auth';
export * from './lib/coin/coin.interface';
export * from './lib/coin/ticker-pair-status.enum';
export * from './lib/coin/ticker-pair.interface';
export * from './lib/exchange/exchange.interface';
export * from './lib/order';
export * from './lib/risk';
export * from './lib/strategy/strategy-config.interface';
export * from './lib/user';
// Export backtest result interfaces (BacktestRun may be duplicated from api-interfaces, export others explicitly)
export * from './lib/market/market-regime.interface';
export * from './lib/paper-trading';
export * from './lib/pipeline';
export {
  BacktestConfiguration,
  BacktestResults,
  BacktestRunStatus,
  StartBacktestDto,
  WalkForwardConfig,
  WalkForwardWindowResult,
  WindowMetrics
} from './lib/strategy/backtest-result.interface';
export * from './lib/strategy/deployment-status.interface';
export * from './lib/strategy/scoring-metrics.interface';
