/**
 * Deployment status and lifecycle interfaces
 */

export enum DeploymentStatus {
  TESTING = 'testing',
  VALIDATED = 'validated',
  PENDING_APPROVAL = 'pending_approval',
  ACTIVE = 'active',
  PAUSED = 'paused',
  DEACTIVATED = 'deactivated',
  DEMOTED = 'demoted',
  TERMINATED = 'terminated'
}

export enum DeploymentPhase {
  INITIAL = 'initial', // 1-2% allocation
  GROWTH = 'growth', // 3-5% allocation
  FULL = 'full' // 5-10% allocation
}

export interface Deployment {
  id: string;
  strategyConfigId: string;
  status: DeploymentStatus;
  allocationPercentage: number; // Percentage of capital allocated
  phase: DeploymentPhase;
  riskLimits: RiskLimits;
  promotionScore: number; // Score at time of promotion
  promotionUserId?: string | null;
  startedAt: Date;
  endedAt?: Date | null;
  pausedUntil?: Date | null;
  deactivationReason?: string | null;
  totalCapital?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskLimits {
  maxDrawdown: number; // Maximum allowed drawdown (e.g., 0.40 = 40%)
  maxDailyLoss: number; // Maximum daily loss percentage (e.g., 0.05 = 5%)
  maxPositionSize: number; // Maximum position size percentage
  stopLossMultiplier: number; // Multiplier for stop loss from backtest max (e.g., 1.5)
  minSharpeRatio?: number; // Minimum Sharpe ratio to maintain
  [key: string]: any;
}

export interface PerformanceMetric {
  id: string;
  deploymentId: string;
  metricDate: string; // ISO date string
  dailyReturn: number;
  cumulativeReturn: number;
  sharpeRatio: number; // Rolling 30-day
  maxDrawdown: number;
  winRate: number;
  tradeCount: number;
  volatility: number;
  benchmarkReturn?: number | null;
  calculatedAt: Date;
}

export interface PromotionRequest {
  strategyConfigId: string;
  initialAllocation?: number; // Default: 1-2%
  reason?: string;
  riskLimits?: Partial<RiskLimits>;
}

export interface PromotionResult {
  success: boolean;
  deployment?: Deployment;
  gateResults: PromotionGateResult[];
  message: string;
}

export interface PromotionGateResult {
  gate: string;
  passed: boolean;
  actualValue: number;
  threshold: number;
  message: string;
}

export interface DemotionRequest {
  deploymentId: string;
  reason: string;
  immediate?: boolean; // If true, deactivate immediately without pause
}

export interface UpdateDeploymentDto {
  allocationPercentage?: number;
  status?: DeploymentStatus;
  pausedUntil?: Date;
  riskLimits?: Partial<RiskLimits>;
}

/**
 * Promotion gate thresholds
 */
export interface PromotionGateThresholds {
  minimumScore: number; // Default: 70
  minimumTrades: number; // Default: 30
  maximumDrawdown: number; // Default: 0.40 (40%)
  wfaConsistency: number; // Default: 0.30 (30% degradation max)
  correlationLimit: number; // Default: 0.70
  positiveReturnsRequired: boolean; // Default: true
  volatilityCap: number; // Default: 1.50 (150% annualized)
  portfolioCapacity: number; // Default: 35 strategies max
}

/**
 * Default promotion gate thresholds
 */
export const DEFAULT_PROMOTION_GATES: PromotionGateThresholds = {
  minimumScore: 70,
  minimumTrades: 30,
  maximumDrawdown: 0.4,
  wfaConsistency: 0.3,
  correlationLimit: 0.7,
  positiveReturnsRequired: true,
  volatilityCap: 1.5,
  portfolioCapacity: 35
};
