export interface Algorithm {
  id: string;
  name: string;
  slug: string;
  service: string;
  description?: string;
  status: boolean;
  evaluate: boolean;
  weight?: number;
  cron: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAlgorithmDto {
  name: string;
  description?: string;
  status?: boolean;
  evaluate?: boolean;
  weight?: number;
  cron?: string;
}

export interface UpdateAlgorithmDto {
  id: string;
  name?: string;
  description?: string;
  status?: boolean;
  evaluate?: boolean;
  weight?: number;
  cron?: string;
}

export interface AlgorithmActivation {
  id: string;
  userId: string;
  algorithmId: string;
  exchangeKeyId: string;
  isActive: boolean;
  allocationPercentage: number;
  config?: Record<string, unknown>;
  activatedAt?: Date;
  deactivatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  algorithm?: Algorithm;
}

export interface AlgorithmPerformance {
  id: string;
  algorithmActivationId: string;
  userId: string;
  roi?: number;
  winRate?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  totalTrades: number;
  riskAdjustedReturn?: number;
  volatility?: number;
  alpha?: number;
  beta?: number;
  rank?: number;
  calculatedAt: Date;
  createdAt: Date;
}

export interface PerformanceMetrics {
  roi?: number;
  winRate?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  totalTrades: number;
  volatility?: number;
  alpha?: number;
  beta?: number;
  rank?: number;
}
