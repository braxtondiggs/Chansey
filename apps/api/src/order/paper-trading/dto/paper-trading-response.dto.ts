import { ApiProperty } from '@nestjs/swagger';

import {
  PaperTradingOrderSide,
  PaperTradingOrderStatus,
  PaperTradingOrderType
} from '../entities/paper-trading-order.entity';
import { PaperTradingStatus, StopConditions } from '../entities/paper-trading-session.entity';
import { PaperTradingSignalDirection, PaperTradingSignalType } from '../entities/paper-trading-signal.entity';
import { SnapshotHolding } from '../entities/paper-trading-snapshot.entity';

export class PaperTradingSessionSummaryDto {
  @ApiProperty({ description: 'Session ID' })
  id: string;

  @ApiProperty({ description: 'Session name' })
  name: string;

  @ApiProperty({ description: 'Current status', enum: PaperTradingStatus })
  status: PaperTradingStatus;

  @ApiProperty({ description: 'Initial capital' })
  initialCapital: number;

  @ApiProperty({ description: 'Current portfolio value', required: false })
  currentPortfolioValue?: number;

  @ApiProperty({ description: 'Total return percentage', required: false })
  totalReturn?: number;

  @ApiProperty({ description: 'Maximum drawdown percentage', required: false })
  maxDrawdown?: number;

  @ApiProperty({ description: 'Total number of trades' })
  totalTrades: number;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiProperty({ description: 'Exchange name' })
  exchangeName: string;

  @ApiProperty({ description: 'When the session was created' })
  createdAt: Date;

  @ApiProperty({ description: 'When the session was started', required: false })
  startedAt?: Date;
}

export class PaperTradingSessionDetailDto extends PaperTradingSessionSummaryDto {
  @ApiProperty({ description: 'Session description', required: false })
  description?: string;

  @ApiProperty({ description: 'Peak portfolio value', required: false })
  peakPortfolioValue?: number;

  @ApiProperty({ description: 'Sharpe ratio', required: false })
  sharpeRatio?: number;

  @ApiProperty({ description: 'Win rate as decimal', required: false })
  winRate?: number;

  @ApiProperty({ description: 'Number of winning trades' })
  winningTrades: number;

  @ApiProperty({ description: 'Number of losing trades' })
  losingTrades: number;

  @ApiProperty({ description: 'Trading fee percentage' })
  tradingFee: number;

  @ApiProperty({ description: 'Pipeline ID if part of pipeline', required: false })
  pipelineId?: string;

  @ApiProperty({ description: 'Auto-stop duration', required: false })
  duration?: string;

  @ApiProperty({ description: 'Stop conditions', required: false })
  stopConditions?: StopConditions;

  @ApiProperty({ description: 'Reason why session stopped', required: false })
  stoppedReason?: string;

  @ApiProperty({ description: 'Algorithm configuration', required: false })
  algorithmConfig?: Record<string, any>;

  @ApiProperty({ description: 'Tick interval in milliseconds' })
  tickIntervalMs: number;

  @ApiProperty({ description: 'Last tick timestamp', required: false })
  lastTickAt?: Date;

  @ApiProperty({ description: 'Number of ticks processed' })
  tickCount: number;

  @ApiProperty({ description: 'Error message if failed', required: false })
  errorMessage?: string;

  @ApiProperty({ description: 'When the session was paused', required: false })
  pausedAt?: Date;

  @ApiProperty({ description: 'When the session was stopped', required: false })
  stoppedAt?: Date;

  @ApiProperty({ description: 'When the session completed', required: false })
  completedAt?: Date;

  @ApiProperty({ description: 'Algorithm ID' })
  algorithmId: string;

  @ApiProperty({ description: 'Exchange key ID' })
  exchangeKeyId: string;
}

export class PaperTradingBalanceDto {
  @ApiProperty({ description: 'Currency symbol' })
  currency: string;

  @ApiProperty({ description: 'Available balance' })
  available: number;

  @ApiProperty({ description: 'Locked balance' })
  locked: number;

  @ApiProperty({ description: 'Total balance' })
  total: number;

  @ApiProperty({ description: 'Average cost basis', required: false })
  averageCost?: number;

  @ApiProperty({ description: 'Current market value', required: false })
  marketValue?: number;

  @ApiProperty({ description: 'Unrealized P&L', required: false })
  unrealizedPnL?: number;
}

export class PaperTradingOrderDto {
  @ApiProperty({ description: 'Order ID' })
  id: string;

  @ApiProperty({ description: 'Order side', enum: PaperTradingOrderSide })
  side: PaperTradingOrderSide;

  @ApiProperty({ description: 'Order type', enum: PaperTradingOrderType })
  orderType: PaperTradingOrderType;

  @ApiProperty({ description: 'Order status', enum: PaperTradingOrderStatus })
  status: PaperTradingOrderStatus;

  @ApiProperty({ description: 'Trading pair symbol' })
  symbol: string;

  @ApiProperty({ description: 'Base currency' })
  baseCurrency: string;

  @ApiProperty({ description: 'Quote currency' })
  quoteCurrency: string;

  @ApiProperty({ description: 'Requested quantity' })
  requestedQuantity: number;

  @ApiProperty({ description: 'Filled quantity' })
  filledQuantity: number;

  @ApiProperty({ description: 'Executed price', required: false })
  executedPrice?: number;

  @ApiProperty({ description: 'Slippage in basis points', required: false })
  slippageBps?: number;

  @ApiProperty({ description: 'Fee paid' })
  fee: number;

  @ApiProperty({ description: 'Total value', required: false })
  totalValue?: number;

  @ApiProperty({ description: 'Realized P&L', required: false })
  realizedPnL?: number;

  @ApiProperty({ description: 'Realized P&L percentage', required: false })
  realizedPnLPercent?: number;

  @ApiProperty({ description: 'When the order was created' })
  createdAt: Date;

  @ApiProperty({ description: 'When the order was executed', required: false })
  executedAt?: Date;

  @ApiProperty({ description: 'Signal ID that triggered this order', required: false })
  signalId?: string;
}

export class PaperTradingSignalDto {
  @ApiProperty({ description: 'Signal ID' })
  id: string;

  @ApiProperty({ description: 'Signal type', enum: PaperTradingSignalType })
  signalType: PaperTradingSignalType;

  @ApiProperty({ description: 'Signal direction', enum: PaperTradingSignalDirection })
  direction: PaperTradingSignalDirection;

  @ApiProperty({ description: 'Instrument/symbol' })
  instrument: string;

  @ApiProperty({ description: 'Quantity' })
  quantity: number;

  @ApiProperty({ description: 'Reference price', required: false })
  price?: number;

  @ApiProperty({ description: 'Confidence score', required: false })
  confidence?: number;

  @ApiProperty({ description: 'Signal reason', required: false })
  reason?: string;

  @ApiProperty({ description: 'Whether processed' })
  processed: boolean;

  @ApiProperty({ description: 'When the signal was created' })
  createdAt: Date;

  @ApiProperty({ description: 'When the signal was processed', required: false })
  processedAt?: Date;
}

export class PaperTradingSnapshotDto {
  @ApiProperty({ description: 'Snapshot ID' })
  id: string;

  @ApiProperty({ description: 'Portfolio value' })
  portfolioValue: number;

  @ApiProperty({ description: 'Cash balance' })
  cashBalance: number;

  @ApiProperty({ description: 'Holdings breakdown' })
  holdings: Record<string, SnapshotHolding>;

  @ApiProperty({ description: 'Cumulative return' })
  cumulativeReturn: number;

  @ApiProperty({ description: 'Drawdown from peak' })
  drawdown: number;

  @ApiProperty({ description: 'Unrealized P&L', required: false })
  unrealizedPnL?: number;

  @ApiProperty({ description: 'Realized P&L', required: false })
  realizedPnL?: number;

  @ApiProperty({ description: 'Snapshot timestamp' })
  timestamp: Date;
}

export class PaperTradingPositionDto {
  @ApiProperty({ description: 'Asset symbol' })
  symbol: string;

  @ApiProperty({ description: 'Quantity held' })
  quantity: number;

  @ApiProperty({ description: 'Average cost basis' })
  averageCost: number;

  @ApiProperty({ description: 'Current market price' })
  currentPrice: number;

  @ApiProperty({ description: 'Market value' })
  marketValue: number;

  @ApiProperty({ description: 'Unrealized P&L' })
  unrealizedPnL: number;

  @ApiProperty({ description: 'Unrealized P&L percentage' })
  unrealizedPnLPercent: number;
}

export class PaperTradingMetricsDto {
  @ApiProperty({ description: 'Initial capital' })
  initialCapital: number;

  @ApiProperty({ description: 'Current portfolio value' })
  currentPortfolioValue: number;

  @ApiProperty({ description: 'Total return' })
  totalReturn: number;

  @ApiProperty({ description: 'Total return percentage' })
  totalReturnPercent: number;

  @ApiProperty({ description: 'Maximum drawdown' })
  maxDrawdown: number;

  @ApiProperty({ description: 'Sharpe ratio', required: false })
  sharpeRatio?: number;

  @ApiProperty({ description: 'Win rate' })
  winRate: number;

  @ApiProperty({ description: 'Total trades' })
  totalTrades: number;

  @ApiProperty({ description: 'Winning trades' })
  winningTrades: number;

  @ApiProperty({ description: 'Losing trades' })
  losingTrades: number;

  @ApiProperty({ description: 'Average win amount', required: false })
  averageWin?: number;

  @ApiProperty({ description: 'Average loss amount', required: false })
  averageLoss?: number;

  @ApiProperty({ description: 'Profit factor', required: false })
  profitFactor?: number;

  @ApiProperty({ description: 'Total fees paid' })
  totalFees: number;

  @ApiProperty({ description: 'Session duration in hours' })
  durationHours: number;
}

export class PaperTradingListResponseDto {
  @ApiProperty({ description: 'List of sessions', type: [PaperTradingSessionSummaryDto] })
  data: PaperTradingSessionSummaryDto[];

  @ApiProperty({ description: 'Total count' })
  total: number;

  @ApiProperty({ description: 'Limit used' })
  limit: number;

  @ApiProperty({ description: 'Offset used' })
  offset: number;
}
