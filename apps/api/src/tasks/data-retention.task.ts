import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { toErrorInfo } from '../shared/error.util';

/**
 * Data Retention Task
 *
 * Nightly sweep that deletes stale rows from append-only / log-style tables
 * to keep Postgres storage bounded. Follows the same raw-SQL pattern as
 * DatabaseMaintenanceTask so no per-entity repositories need to be injected.
 *
 * Each rule is fail-safe: one table's error does not abort the rest of the
 * sweep. Every window is env-tunable (see env.validation.ts) and set to a
 * conservative default that preserves any row still needed for current
 * trading, reporting, or compliance workflows.
 *
 * Runs at 04:15 UTC — after RedisMaintenanceTask (04:00) and before
 * DatabaseMaintenanceTask (04:30) so the nightly ANALYZE sees the pruned
 * tables and refreshes planner stats.
 */
@Injectable()
export class DataRetentionTask {
  private readonly logger = new Logger(DataRetentionTask.name);
  private running = false;

  private static readonly DEFAULTS = {
    EXCHANGE_KEY_HEALTH_LOG_DAYS: 30,
    PAPER_TRADING_SNAPSHOT_DAYS: 60,
    PAPER_TRADING_SESSION_DAYS: 60,
    BACKTEST_DAYS: 90,
    OPTIMIZATION_RUN_DAYS: 60,
    PIPELINE_DAYS: 60,
    DRIFT_ALERT_DAYS: 90,
    NOTIFICATION_READ_DAYS: 30,
    NOTIFICATION_UNREAD_DAYS: 180,
    MARKET_REGIME_DAYS: 365,
    STRATEGY_SCORE_DAYS: 365,
    PERFORMANCE_METRIC_DAYS: 365,
    LISTING_TRADE_POSITION_DAYS: 60,
    LISTING_ANNOUNCEMENT_DAYS: 365,
    LISTING_CANDIDATE_DAYS: 180,
    COMPARISON_REPORT_DAYS: 90,
    BACKTEST_RUN_DAYS: 60,
    MARKET_DATA_SET_DAYS: 180,
    ALGORITHM_PERFORMANCE_DAYS: 365,
    AUDIT_LOG_DAYS: 1825,
    SECURITY_AUDIT_LOG_DAYS: 730
  } as const;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Cron('15 4 * * *', { timeZone: 'UTC' })
  async run(): Promise<void> {
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Data retention task disabled (dev/DISABLE_BACKGROUND_TASKS)');
      return;
    }

    if (this.running) {
      this.logger.warn('Data retention already running, skipping');
      return;
    }

    this.running = true;
    const startTime = Date.now();
    const results: PruneResult[] = [];

    try {
      this.logger.log('Starting scheduled data retention sweep');

      results.push(await this.pruneExchangeKeyHealthLog());
      results.push(await this.prunePaperTradingSnapshots());
      results.push(await this.prunePaperTradingSessions());
      results.push(await this.pruneBacktests());
      results.push(await this.pruneOptimizationRuns());
      results.push(await this.prunePipelines());
      results.push(await this.pruneDriftAlerts());
      results.push(await this.pruneReadNotifications());
      results.push(await this.pruneUnreadNotifications());
      results.push(await this.pruneMarketRegimes());
      results.push(await this.pruneStrategyScores());
      results.push(await this.prunePerformanceMetrics());
      results.push(await this.pruneListingTradePositions());
      results.push(await this.pruneListingAnnouncements());
      results.push(await this.pruneListingCandidates());
      results.push(await this.pruneComparisonReports());
      results.push(await this.pruneBacktestRuns());
      results.push(await this.pruneMarketDataSets());
      results.push(await this.pruneAlgorithmPerformances());
      results.push(await this.pruneAuditLogs());
      results.push(await this.pruneSecurityAuditLog());
    } finally {
      this.running = false;
    }

    const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
    const failed = results.filter((r) => r.error !== undefined);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    this.logger.log(
      `Data retention complete: ${totalDeleted} rows across ${results.length - failed.length}/${results.length} tables in ${elapsedSec}s`
    );

    for (const r of results) {
      if (r.error) {
        this.logger.error(`  ${r.table}: FAILED after ${r.elapsedMs}ms — ${r.error}`);
      } else if (r.deleted > 0) {
        this.logger.log(`  ${r.table}: ${r.deleted} deleted (${r.elapsedMs}ms, retention ${r.retentionDays}d)`);
      }
    }
  }

  private getDays(envKey: string, fallback: number): number {
    const raw = process.env[envKey];
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  }

  /**
   * Executes a DELETE and returns the row count without streaming IDs back to Node.
   *
   * Simple callers pass a bare `DELETE ... WHERE ...` and this method wraps it
   * in a CTE that returns a single `count(*)` row. Callers whose SQL already
   * starts with `WITH` (because they need auxiliary CTEs — e.g. market_regimes
   * nullifying the self-reference before delete) must handle their own count
   * projection and end with `SELECT count(*)::int AS deleted FROM <cte>`; the
   * `WITH` prefix is detected and the SQL runs as-is.
   */
  private async runDelete(
    table: string,
    retentionDays: number,
    sql: string,
    params: unknown[] = []
  ): Promise<PruneResult> {
    const start = Date.now();
    try {
      const trimmed = sql.trimStart();
      const wrapped = /^with\b/i.test(trimmed)
        ? sql
        : `WITH deleted_rows AS (${sql} RETURNING 1)
           SELECT count(*)::int AS deleted FROM deleted_rows`;
      const rows = await this.dataSource.query(wrapped, params);
      const deleted = Number(rows?.[0]?.deleted ?? 0);
      return { table, deleted, retentionDays, elapsedMs: Date.now() - start };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      return { table, deleted: 0, retentionDays, elapsedMs: Date.now() - start, error: err.message };
    }
  }

  private pruneExchangeKeyHealthLog(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_EXCHANGE_KEY_HEALTH_LOG_DAYS',
      DataRetentionTask.DEFAULTS.EXCHANGE_KEY_HEALTH_LOG_DAYS
    );
    return this.runDelete(
      'exchange_key_health_log',
      days,
      `DELETE FROM "exchange_key_health_log"
       WHERE "checkedAt" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private prunePaperTradingSnapshots(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_PAPER_TRADING_SNAPSHOT_DAYS',
      DataRetentionTask.DEFAULTS.PAPER_TRADING_SNAPSHOT_DAYS
    );
    // Only trim snapshots whose parent session is terminal; active/paused sessions keep full history.
    return this.runDelete(
      'paper_trading_snapshots',
      days,
      `DELETE FROM "paper_trading_snapshots" s
       USING "paper_trading_sessions" ps
       WHERE s."sessionId" = ps.id
         AND ps.status IN ('STOPPED','COMPLETED','FAILED')
         AND s."timestamp" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private prunePaperTradingSessions(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_PAPER_TRADING_SESSION_DAYS',
      DataRetentionTask.DEFAULTS.PAPER_TRADING_SESSION_DAYS
    );
    // Terminal sessions older than N days; children (accounts, orders, signals, snapshots) cascade.
    // Preserves sessions still linked to a live pipeline.
    return this.runDelete(
      'paper_trading_sessions',
      days,
      `DELETE FROM "paper_trading_sessions"
       WHERE status IN ('STOPPED','COMPLETED','FAILED')
         AND COALESCE("stoppedAt","completedAt","updatedAt") < (now() - ($1 || ' days')::interval)
         AND id NOT IN (
           SELECT "paperTradingSessionId" FROM "pipelines" WHERE "paperTradingSessionId" IS NOT NULL
         )`,
      [String(days)]
    );
  }

  private pruneBacktests(): Promise<PruneResult> {
    const days = this.getDays('DATA_RETENTION_BACKTEST_DAYS', DataRetentionTask.DEFAULTS.BACKTEST_DAYS);
    // Terminal backtests older than N days. Children (trades, signals, snapshots, fills) cascade.
    // Preserves any backtest still referenced by a pipeline.
    return this.runDelete(
      'backtests',
      days,
      `DELETE FROM "backtests"
       WHERE status IN ('COMPLETED','FAILED','CANCELLED')
         AND "updatedAt" < (now() - ($1 || ' days')::interval)
         AND NOT EXISTS (
           SELECT 1 FROM "pipelines"
           WHERE "historicalBacktestId" = backtests.id
              OR "liveReplayBacktestId" = backtests.id
         )`,
      [String(days)]
    );
  }

  private pruneOptimizationRuns(): Promise<PruneResult> {
    const days = this.getDays('DATA_RETENTION_OPTIMIZATION_RUN_DAYS', DataRetentionTask.DEFAULTS.OPTIMIZATION_RUN_DAYS);
    // Terminal optimization runs older than N days. optimization_results cascades.
    // Preserves runs still referenced by a pipeline.
    return this.runDelete(
      'optimization_runs',
      days,
      `DELETE FROM "optimization_runs"
       WHERE status IN ('COMPLETED','FAILED','CANCELLED')
         AND COALESCE("completedAt","createdAt") < (now() - ($1 || ' days')::interval)
         AND id NOT IN (
           SELECT "optimizationRunId" FROM "pipelines" WHERE "optimizationRunId" IS NOT NULL
         )`,
      [String(days)]
    );
  }

  private prunePipelines(): Promise<PruneResult> {
    const days = this.getDays('DATA_RETENTION_PIPELINE_DAYS', DataRetentionTask.DEFAULTS.PIPELINE_DAYS);
    // Terminal pipelines older than N days. Child backtests/optimizations/paper sessions
    // are SET NULL so they survive and fall under their own retention rules.
    return this.runDelete(
      'pipelines',
      days,
      `DELETE FROM "pipelines"
       WHERE status IN ('COMPLETED','FAILED','CANCELLED')
         AND COALESCE("completedAt","updatedAt") < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private pruneDriftAlerts(): Promise<PruneResult> {
    const days = this.getDays('DATA_RETENTION_DRIFT_ALERT_DAYS', DataRetentionTask.DEFAULTS.DRIFT_ALERT_DAYS);
    // Unresolved alerts are never pruned — they represent open risk signals.
    return this.runDelete(
      'drift_alerts',
      days,
      `DELETE FROM "drift_alerts"
       WHERE resolved = true
         AND COALESCE("resolvedAt","createdAt") < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private pruneReadNotifications(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_NOTIFICATION_READ_DAYS',
      DataRetentionTask.DEFAULTS.NOTIFICATION_READ_DAYS
    );
    return this.runDelete(
      'notification (read)',
      days,
      `DELETE FROM "notification"
       WHERE read = true
         AND "createdAt" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private pruneUnreadNotifications(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_NOTIFICATION_UNREAD_DAYS',
      DataRetentionTask.DEFAULTS.NOTIFICATION_UNREAD_DAYS
    );
    return this.runDelete(
      'notification (unread)',
      days,
      `DELETE FROM "notification"
       WHERE read = false
         AND "createdAt" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private pruneMarketRegimes(): Promise<PruneResult> {
    const days = this.getDays('DATA_RETENTION_MARKET_REGIME_DAYS', DataRetentionTask.DEFAULTS.MARKET_REGIME_DAYS);
    // Only historical regimes (effective_until set). The current regime per asset has effective_until = NULL.
    // Nullifies previousRegimeId pointers first so we don't violate the self-reference.
    return this.runDelete(
      'market_regimes',
      days,
      `WITH doomed AS (
         SELECT id FROM "market_regimes"
         WHERE "effective_until" IS NOT NULL
           AND "effective_until" < (now() - ($1 || ' days')::interval)
       ),
       _unlink AS (
         UPDATE "market_regimes"
         SET "previousRegimeId" = NULL
         WHERE "previousRegimeId" IN (SELECT id FROM doomed)
       ),
       deleted_rows AS (
         DELETE FROM "market_regimes"
         WHERE id IN (SELECT id FROM doomed)
         RETURNING 1
       )
       SELECT count(*)::int AS deleted FROM deleted_rows`,
      [String(days)]
    );
  }

  private pruneStrategyScores(): Promise<PruneResult> {
    const days = this.getDays('DATA_RETENTION_STRATEGY_SCORE_DAYS', DataRetentionTask.DEFAULTS.STRATEGY_SCORE_DAYS);
    return this.runDelete(
      'strategy_scores',
      days,
      `DELETE FROM "strategy_scores"
       WHERE "calculatedAt" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private prunePerformanceMetrics(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_PERFORMANCE_METRIC_DAYS',
      DataRetentionTask.DEFAULTS.PERFORMANCE_METRIC_DAYS
    );
    return this.runDelete(
      'performance_metrics',
      days,
      `DELETE FROM "performance_metrics"
       WHERE "date" < (current_date - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private pruneListingTradePositions(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_LISTING_TRADE_POSITION_DAYS',
      DataRetentionTask.DEFAULTS.LISTING_TRADE_POSITION_DAYS
    );
    // OPEN positions are never pruned — they represent live capital.
    return this.runDelete(
      'listing_trade_positions',
      days,
      `DELETE FROM "listing_trade_positions"
       WHERE status <> 'OPEN'
         AND "updatedAt" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private pruneListingAnnouncements(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_LISTING_ANNOUNCEMENT_DAYS',
      DataRetentionTask.DEFAULTS.LISTING_ANNOUNCEMENT_DAYS
    );
    // Drop old announcements only once no trade position still points at them.
    return this.runDelete(
      'listing_announcements',
      days,
      `DELETE FROM "listing_announcements"
       WHERE "createdAt" < (now() - ($1 || ' days')::interval)
         AND id NOT IN (
           SELECT "announcementId" FROM "listing_trade_positions" WHERE "announcementId" IS NOT NULL
         )`,
      [String(days)]
    );
  }

  private pruneListingCandidates(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_LISTING_CANDIDATE_DAYS',
      DataRetentionTask.DEFAULTS.LISTING_CANDIDATE_DAYS
    );
    // Only candidates that never qualified and were never traded — qualified/traded rows keep their history.
    return this.runDelete(
      'listing_candidates',
      days,
      `DELETE FROM "listing_candidates"
       WHERE qualified = false
         AND "lastTradedAt" IS NULL
         AND "updatedAt" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private pruneComparisonReports(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_COMPARISON_REPORT_DAYS',
      DataRetentionTask.DEFAULTS.COMPARISON_REPORT_DAYS
    );
    // comparison_report_runs cascades on deletion.
    return this.runDelete(
      'comparison_reports',
      days,
      `DELETE FROM "comparison_reports"
       WHERE "createdAt" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private pruneBacktestRuns(): Promise<PruneResult> {
    const days = this.getDays('DATA_RETENTION_BACKTEST_RUN_DAYS', DataRetentionTask.DEFAULTS.BACKTEST_RUN_DAYS);
    // BacktestRunStatus enum uses lowercase values.
    return this.runDelete(
      'backtest_runs',
      days,
      `DELETE FROM "backtest_runs"
       WHERE status IN ('completed','failed')
         AND "updatedAt" < (now() - ($1 || ' days')::interval)
         AND NOT EXISTS (
           SELECT 1 FROM "strategy_scores"
           WHERE "backtestRunIds" IS NOT NULL
             AND backtest_runs.id = ANY("backtestRunIds")
         )`,
      [String(days)]
    );
  }

  private pruneMarketDataSets(): Promise<PruneResult> {
    const days = this.getDays('DATA_RETENTION_MARKET_DATA_SET_DAYS', DataRetentionTask.DEFAULTS.MARKET_DATA_SET_DAYS);
    // Only unreferenced datasets — backtests.marketDataSetId is SET NULL on delete, so we skip datasets still in use.
    return this.runDelete(
      'market_data_sets',
      days,
      `DELETE FROM "market_data_sets"
       WHERE "updatedAt" < (now() - ($1 || ' days')::interval)
         AND id NOT IN (
           SELECT "marketDataSetId" FROM "backtests" WHERE "marketDataSetId" IS NOT NULL
         )`,
      [String(days)]
    );
  }

  private pruneAlgorithmPerformances(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_ALGORITHM_PERFORMANCE_DAYS',
      DataRetentionTask.DEFAULTS.ALGORITHM_PERFORMANCE_DAYS
    );
    return this.runDelete(
      'algorithm_performances',
      days,
      `DELETE FROM "algorithm_performances"
       WHERE "calculatedAt" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private pruneAuditLogs(): Promise<PruneResult> {
    // Compliance retention — default 5 years per project spec.
    const days = this.getDays('DATA_RETENTION_AUDIT_LOG_DAYS', DataRetentionTask.DEFAULTS.AUDIT_LOG_DAYS);
    return this.runDelete(
      'audit_logs',
      days,
      `DELETE FROM "audit_logs"
       WHERE "timestamp" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }

  private pruneSecurityAuditLog(): Promise<PruneResult> {
    const days = this.getDays(
      'DATA_RETENTION_SECURITY_AUDIT_LOG_DAYS',
      DataRetentionTask.DEFAULTS.SECURITY_AUDIT_LOG_DAYS
    );
    return this.runDelete(
      'security_audit_log',
      days,
      `DELETE FROM "security_audit_log"
       WHERE "createdAt" < (now() - ($1 || ' days')::interval)`,
      [String(days)]
    );
  }
}

interface PruneResult {
  table: string;
  deleted: number;
  retentionDays: number;
  elapsedMs: number;
  error?: string;
}
