/**
 * Trading state interfaces for global kill switch
 */

export interface TradingStateDto {
  id: string;
  tradingEnabled: boolean;
  haltedAt: string | null; // ISO date string
  haltedBy: string | null;
  haltReason: string | null;
  resumedAt: string | null; // ISO date string
  resumedBy: string | null;
  resumeReason: string | null;
  haltCount: number;
  metadata: Record<string, unknown> | null;
  updatedAt: string; // ISO date string
  haltDurationMs?: number;
}

export interface HaltTradingRequest {
  reason: string;
  pauseDeployments?: boolean;
  cancelOpenOrders?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ResumeTradingRequest {
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface CancelAllOrdersResult {
  totalOrders: number;
  successfulCancellations: number;
  failedCancellations: number;
  errors: Array<{
    orderId: string;
    userId: string;
    error: string;
  }>;
}

export enum TradingHaltSource {
  MANUAL = 'manual',
  CIRCUIT_BREAKER = 'circuit_breaker',
  SYSTEM = 'system'
}
