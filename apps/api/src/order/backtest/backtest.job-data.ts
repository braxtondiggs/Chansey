import { BacktestType } from './backtest.entity';

export interface BacktestJobData {
  backtestId: string;
  userId: string;
  datasetId: string;
  algorithmId: string;
  deterministicSeed: string;
  mode: BacktestType;
}
