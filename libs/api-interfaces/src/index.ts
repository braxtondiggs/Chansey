export * from './lib/api-interfaces';
export * from './lib/auth';
export * from './lib/user';
export * from './lib/exchange/exchange.interface';
export * from './lib/coin/coin.interface';
export * from './lib/coin/ticker-pair.interface';
export * from './lib/coin/ticker-pair-status.enum';
export * from './lib/risk';
export * from './lib/algorithm/algorithm.interface';
export * from './lib/order';
export * from './lib/audit/audit-entry.interface';
export * from './lib/strategy/strategy-config.interface';
// Export backtest result interfaces (BacktestRun may be duplicated from api-interfaces, export others explicitly)
export {
  BacktestRunStatus,
  BacktestConfiguration,
  BacktestResults,
  WalkForwardConfig,
  WalkForwardWindowResult,
  WindowMetrics,
  StartBacktestDto
} from './lib/strategy/backtest-result.interface';
export * from './lib/strategy/scoring-metrics.interface';
export * from './lib/strategy/deployment-status.interface';
export * from './lib/market/market-regime.interface';
