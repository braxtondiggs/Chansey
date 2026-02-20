/**
 * Audit entry interfaces for immutable logging
 */

export enum AuditEventType {
  // Strategy events
  STRATEGY_CREATED = 'STRATEGY_CREATED',
  STRATEGY_UPDATED = 'STRATEGY_UPDATED',
  STRATEGY_MODIFIED = 'STRATEGY_MODIFIED',
  STRATEGY_DELETED = 'STRATEGY_DELETED',
  STRATEGY_PROMOTED = 'STRATEGY_PROMOTED',
  STRATEGY_DEMOTED = 'STRATEGY_DEMOTED',

  // Backtest events
  BACKTEST_STARTED = 'BACKTEST_STARTED',
  BACKTEST_COMPLETED = 'BACKTEST_COMPLETED',
  BACKTEST_FAILED = 'BACKTEST_FAILED',

  // Scoring events
  SCORE_CALCULATED = 'SCORE_CALCULATED',
  GATE_EVALUATION = 'GATE_EVALUATION',

  // Promotion/deployment events
  PROMOTION_REQUESTED = 'PROMOTION_REQUESTED',
  PROMOTION_APPROVED = 'PROMOTION_APPROVED',
  PROMOTION_REJECTED = 'PROMOTION_REJECTED',
  DEPLOYMENT_STARTED = 'DEPLOYMENT_STARTED',
  DEPLOYMENT_ACTIVATED = 'DEPLOYMENT_ACTIVATED',
  DEPLOYMENT_PAUSED = 'DEPLOYMENT_PAUSED',
  DEPLOYMENT_RESUMED = 'DEPLOYMENT_RESUMED',
  DEPLOYMENT_DEACTIVATED = 'DEPLOYMENT_DEACTIVATED',
  DEPLOYMENT_TERMINATED = 'DEPLOYMENT_TERMINATED',

  // Risk management events
  ALLOCATION_CHANGED = 'ALLOCATION_CHANGED',
  ALLOCATION_ADJUSTED = 'ALLOCATION_ADJUSTED',
  RISK_LIMIT_CHANGED = 'RISK_LIMIT_CHANGED',
  RISK_BREACH = 'RISK_BREACH',

  // Monitoring events
  DRIFT_DETECTED = 'DRIFT_DETECTED',
  DRIFT_ACKNOWLEDGED = 'DRIFT_ACKNOWLEDGED',
  ALERT_SENT = 'ALERT_SENT',
  RISK_EVALUATION = 'RISK_EVALUATION',

  // Regime events
  REGIME_CHANGED = 'REGIME_CHANGED',
  REGIME_SCALED_ALLOCATION = 'REGIME_SCALED_ALLOCATION',

  // Configuration events
  PARAMETER_CHANGED = 'PARAMETER_CHANGED',

  // Manual intervention
  MANUAL_INTERVENTION = 'MANUAL_INTERVENTION'
}

export interface AuditLog {
  id: string;
  eventType: AuditEventType;
  entityType: string; // strategy, deployment, backtest, etc.
  entityId: string;
  userId?: string | null; // User who triggered event (null for system events)
  timestamp: Date;
  beforeState?: Record<string, any> | null;
  afterState?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
  correlationId?: string | null; // ID linking related events
  integrity: string; // SHA-256 hash for tamper detection
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateAuditLogDto {
  eventType: AuditEventType;
  entityType: string;
  entityId: string;
  userId?: string;
  beforeState?: Record<string, any>;
  afterState?: Record<string, any>;
  metadata?: Record<string, any>;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditTrailQuery {
  entityType?: string;
  entityId?: string;
  eventType?: AuditEventType | AuditEventType[];
  userId?: string;
  startDate?: string;
  endDate?: string;
  correlationId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditTrailResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Integrity verification result
 */
export interface IntegrityVerification {
  entryId: string;
  valid: boolean;
  expectedHash: string;
  actualHash: string;
  message: string;
}

/**
 * Specialized audit log metadata types
 */
export interface PromotionAuditMetadata {
  strategyName: string;
  score: number;
  gateResults: Array<{
    gate: string;
    passed: boolean;
    value: number;
  }>;
  allocation: number;
  reason?: string;
}

export interface ParameterChangeAuditMetadata {
  strategyName: string;
  changedParameters: Record<
    string,
    {
      oldValue: any;
      newValue: any;
    }
  >;
  reason?: string;
}

export interface DriftAuditMetadata {
  deploymentId: string;
  strategyName: string;
  driftType: string;
  severity: string;
  expectedValue: number;
  observedValue: number;
  delta: number;
  recommendedAction: string;
}

export interface DemotionAuditMetadata {
  deploymentId: string;
  strategyName: string;
  reason: string;
  finalAllocation: number;
  performanceMetrics: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
}
