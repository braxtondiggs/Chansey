// ============================================================================
// Types (mirroring backend DTOs)
// ============================================================================

export interface LiveTradeFiltersDto {
  startDate?: string;
  endDate?: string;
  algorithmId?: string;
  userId?: string;
}

export interface AlgorithmListQueryDto extends LiveTradeFiltersDto {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  search?: string;
  isActive?: boolean;
}

export interface OrderListQueryDto extends LiveTradeFiltersDto {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  algorithmActivationId?: string;
  symbol?: string;
}

export interface UserActivityQueryDto {
  page?: number;
  limit?: number;
  minActiveAlgorithms?: number;
  search?: string;
}

export type ExportFormat = 'csv' | 'json';

// Overview DTOs
export interface LiveTradeSummaryDto {
  activeAlgorithms: number;
  totalOrders: number;
  orders24h: number;
  orders7d: number;
  totalVolume: number;
  totalPnL: number;
  avgSlippageBps: number;
  activeUsers: number;
}

export interface TopPerformingAlgorithmDto {
  algorithmId: string;
  algorithmName: string;
  activeActivations: number;
  totalOrders: number;
  avgRoi: number;
  avgWinRate: number;
  avgSlippageBps: number;
}

export interface RecentOrderDto {
  id: string;
  symbol: string;
  side: string;
  type: string;
  cost: number;
  actualSlippageBps?: number;
  algorithmName: string;
  userEmail: string;
  createdAt: string;
}

export interface AlertsSummaryDto {
  critical: number;
  warning: number;
  info: number;
}

export interface LiveTradeOverviewDto {
  summary: LiveTradeSummaryDto;
  topAlgorithms: TopPerformingAlgorithmDto[];
  recentOrders: RecentOrderDto[];
  alertsSummary: AlertsSummaryDto;
}

// Algorithm DTOs
export interface AlgorithmActivationListItemDto {
  id: string;
  algorithmId: string;
  algorithmName: string;
  userId: string;
  userEmail: string;
  isActive: boolean;
  allocationPercentage: number;
  activatedAt?: string;
  deactivatedAt?: string;
  totalOrders: number;
  orders24h: number;
  totalVolume: number;
  roi?: number;
  winRate?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  avgSlippageBps?: number;
  exchangeName: string;
  createdAt: string;
}

export interface PaginatedAlgorithmListDto {
  data: AlgorithmActivationListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

// Order DTOs
export interface AlgorithmicOrderListItemDto {
  id: string;
  symbol: string;
  orderId: string;
  side: string;
  type: string;
  status: string;
  quantity: number;
  price: number;
  executedQuantity: number;
  cost?: number;
  averagePrice?: number;
  expectedPrice?: number;
  actualSlippageBps?: number;
  fee: number;
  gainLoss?: number;
  algorithmActivationId: string;
  algorithmName: string;
  userId: string;
  userEmail: string;
  exchangeName: string;
  transactTime: string;
  createdAt: string;
}

export interface PaginatedOrderListDto {
  data: AlgorithmicOrderListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  totalVolume: number;
  totalPnL: number;
  avgSlippageBps: number;
}

// Comparison DTOs
export interface PerformanceMetricsDto {
  totalReturn?: number;
  sharpeRatio?: number;
  winRate?: number;
  maxDrawdown?: number;
  totalTrades?: number;
  avgSlippageBps?: number;
  totalVolume?: number;
  volatility?: number;
}

export interface DeviationMetricsDto {
  totalReturn?: number;
  sharpeRatio?: number;
  winRate?: number;
  maxDrawdown?: number;
  avgSlippageBps?: number;
}

export interface AlgorithmComparisonDto {
  algorithmId: string;
  algorithmName: string;
  activeActivations: number;
  totalLiveOrders: number;
  backtestId?: string;
  backtestName?: string;
  liveMetrics: PerformanceMetricsDto;
  backtestMetrics?: PerformanceMetricsDto;
  deviations?: DeviationMetricsDto;
  hasSignificantDeviation: boolean;
  alerts: string[];
}

export interface ComparisonDto {
  comparison: AlgorithmComparisonDto;
  periodStart: string;
  periodEnd: string;
  calculatedAt: string;
}

// Slippage DTOs
export interface SlippageStatsDto {
  avgBps: number;
  medianBps: number;
  minBps: number;
  maxBps: number;
  p95Bps: number;
  stdDevBps: number;
  orderCount: number;
}

export interface SlippageByAlgorithmDto {
  algorithmId: string;
  algorithmName: string;
  liveSlippage: SlippageStatsDto;
  backtestSlippage?: SlippageStatsDto;
  slippageDifferenceBps: number;
}

export interface SlippageByTimeDto {
  hour: number;
  avgBps: number;
  orderCount: number;
}

export interface SlippageBySizeDto {
  bucket: string;
  minSize: number;
  maxSize: number;
  avgBps: number;
  orderCount: number;
}

export interface SlippageBySymbolDto {
  symbol: string;
  avgBps: number;
  orderCount: number;
  totalVolume: number;
}

export interface SlippageAnalysisDto {
  overallLive: SlippageStatsDto;
  overallBacktest?: SlippageStatsDto;
  overallDifferenceBps: number;
  byAlgorithm: SlippageByAlgorithmDto[];
  byTimeOfDay: SlippageByTimeDto[];
  byOrderSize: SlippageBySizeDto[];
  bySymbol: SlippageBySymbolDto[];
  periodStart: string;
  periodEnd: string;
}

// User Activity DTOs
export interface UserAlgorithmSummaryDto {
  activationId: string;
  algorithmName: string;
  isActive: boolean;
  totalOrders: number;
  roi?: number;
}

export interface UserActivityItemDto {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  totalActivations: number;
  activeAlgorithms: number;
  totalOrders: number;
  orders24h: number;
  orders7d: number;
  totalVolume: number;
  totalPnL: number;
  avgSlippageBps?: number;
  registeredAt: string;
  lastOrderAt?: string;
  algorithms: UserAlgorithmSummaryDto[];
}

export interface PaginatedUserActivityDto {
  data: UserActivityItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

// Alert DTOs
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertType =
  | 'sharpe_ratio_low'
  | 'win_rate_low'
  | 'drawdown_high'
  | 'return_low'
  | 'slippage_high'
  | 'no_orders'
  | 'activation_stale';

export interface PerformanceAlertDto {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  algorithmId: string;
  algorithmName: string;
  algorithmActivationId?: string;
  userId?: string;
  userEmail?: string;
  liveValue: number;
  backtestValue?: number;
  threshold: number;
  deviationPercent: number;
  createdAt: string;
}

export interface AlertThresholdsDto {
  sharpeRatioWarning: number;
  sharpeRatioCritical: number;
  winRateWarning: number;
  winRateCritical: number;
  maxDrawdownWarning: number;
  maxDrawdownCritical: number;
  totalReturnWarning: number;
  totalReturnCritical: number;
  slippageWarningBps: number;
  slippageCriticalBps: number;
}

export interface AlertsDto {
  alerts: PerformanceAlertDto[];
  total: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  thresholds: AlertThresholdsDto;
  lastCalculatedAt: string;
}
