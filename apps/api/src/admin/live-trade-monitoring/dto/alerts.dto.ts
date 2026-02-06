import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Alert severity levels
 */
export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

/**
 * Alert types for live trade monitoring
 */
export enum AlertType {
  SHARPE_RATIO_LOW = 'sharpe_ratio_low',
  WIN_RATE_LOW = 'win_rate_low',
  DRAWDOWN_HIGH = 'drawdown_high',
  RETURN_LOW = 'return_low',
  SLIPPAGE_HIGH = 'slippage_high',
  NO_ORDERS = 'no_orders',
  ACTIVATION_STALE = 'activation_stale'
}

/**
 * Individual performance alert
 */
export class PerformanceAlertDto {
  @ApiProperty({ description: 'Unique alert ID' })
  id: string;

  @ApiProperty({ description: 'Alert type', enum: AlertType })
  type: AlertType;

  @ApiProperty({ description: 'Alert severity', enum: AlertSeverity })
  severity: AlertSeverity;

  @ApiProperty({ description: 'Alert title', example: 'Sharpe Ratio Below Threshold' })
  title: string;

  @ApiProperty({ description: 'Alert message with details' })
  message: string;

  @ApiProperty({ description: 'Algorithm ID' })
  algorithmId: string;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiPropertyOptional({ description: 'Algorithm activation ID (if user-specific)' })
  algorithmActivationId?: string;

  @ApiPropertyOptional({ description: 'User ID (if user-specific)' })
  userId?: string;

  @ApiPropertyOptional({ description: 'User email (if user-specific)' })
  userEmail?: string;

  @ApiProperty({ description: 'Live metric value that triggered the alert', example: 0.8 })
  liveValue: number;

  @ApiPropertyOptional({ description: 'Backtest metric value for comparison', example: 1.5 })
  backtestValue?: number;

  @ApiProperty({ description: 'Threshold that was breached', example: 1.0 })
  threshold: number;

  @ApiProperty({ description: 'Deviation percentage from threshold or backtest', example: -46.7 })
  deviationPercent: number;

  @ApiProperty({ description: 'When the alert was generated' })
  createdAt: string;
}

/**
 * Alert thresholds configuration
 */
export class AlertThresholdsDto {
  @ApiProperty({ description: 'Sharpe ratio warning threshold (percentage lower than backtest)', example: 25 })
  sharpeRatioWarning: number;

  @ApiProperty({ description: 'Sharpe ratio critical threshold', example: 50 })
  sharpeRatioCritical: number;

  @ApiProperty({ description: 'Win rate warning threshold (percentage lower than backtest)', example: 10 })
  winRateWarning: number;

  @ApiProperty({ description: 'Win rate critical threshold', example: 20 })
  winRateCritical: number;

  @ApiProperty({ description: 'Max drawdown warning threshold (percentage higher than backtest)', example: 25 })
  maxDrawdownWarning: number;

  @ApiProperty({ description: 'Max drawdown critical threshold', example: 50 })
  maxDrawdownCritical: number;

  @ApiProperty({ description: 'Total return warning threshold (percentage lower than backtest)', example: 20 })
  totalReturnWarning: number;

  @ApiProperty({ description: 'Total return critical threshold', example: 40 })
  totalReturnCritical: number;

  @ApiProperty({ description: 'Slippage warning threshold (additional bps above backtest)', example: 30 })
  slippageWarningBps: number;

  @ApiProperty({ description: 'Slippage critical threshold', example: 50 })
  slippageCriticalBps: number;
}

/**
 * Complete alerts response
 */
export class AlertsDto {
  @ApiProperty({ description: 'List of current alerts', type: [PerformanceAlertDto] })
  alerts: PerformanceAlertDto[];

  @ApiProperty({ description: 'Total number of alerts' })
  total: number;

  @ApiProperty({ description: 'Number of critical alerts' })
  criticalCount: number;

  @ApiProperty({ description: 'Number of warning alerts' })
  warningCount: number;

  @ApiProperty({ description: 'Number of info alerts' })
  infoCount: number;

  @ApiProperty({ description: 'Current alert thresholds' })
  thresholds: AlertThresholdsDto;

  @ApiProperty({ description: 'When alerts were last calculated' })
  lastCalculatedAt: string;
}
