import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Between, Repository } from 'typeorm';

import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

import { PerformanceMetric } from '../strategy/entities/performance-metric.entity';
import { escapeLikeWildcards } from '../utils/sanitize.util';

interface TimelineEntry {
  timestamp: Date;
  category: string;
  eventType: string;
  entityType: string;
  entityId: string;
  summary: string;
}

/**
 * AuditQueryService
 *
 * Advanced querying and analysis of audit logs.
 *
 * Features:
 * - Complex audit trail queries
 * - Time-series analysis
 * - Event correlation and workflow reconstruction
 * - Compliance reporting
 * - Anomaly detection in audit patterns
 */
@Injectable()
export class AuditQueryService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    @InjectRepository(PerformanceMetric)
    private readonly performanceMetricRepo: Repository<PerformanceMetric>,
    private readonly auditService: AuditService
  ) {}

  /**
   * Get complete audit trail for a strategy lifecycle
   * (from creation through deployment to demotion/termination)
   */
  async getStrategyLifecycle(strategyConfigId: string): Promise<{
    strategyEvents: AuditLog[];
    backtestRuns: AuditLog[];
    deployments: AuditLog[];
    driftAlerts: AuditLog[];
    riskBreaches: AuditLog[];
    timeline: TimelineEntry[];
  }> {
    // Get all events related to this strategy
    const strategyEvents = await this.auditLogRepository.find({
      where: { entityType: 'StrategyConfig', entityId: strategyConfigId },
      order: { timestamp: 'ASC' }
    });

    // Get backtest runs
    const backtestRuns = await this.auditLogRepository
      .createQueryBuilder('audit')
      .where('audit.entityType = :entityType', { entityType: 'BacktestRun' })
      .andWhere("audit.afterState->>'strategyConfigId' = :strategyConfigId", { strategyConfigId })
      .orderBy('audit.timestamp', 'ASC')
      .getMany();

    // Get deployments (by finding deployment creation events then getting all events for those deployments)
    const deploymentCreationEvents = await this.auditLogRepository
      .createQueryBuilder('audit')
      .where('audit.eventType = :eventType', { eventType: 'STRATEGY_PROMOTED' })
      .andWhere("audit.afterState->>'strategyConfigId' = :strategyConfigId", { strategyConfigId })
      .getMany();

    const deploymentIds = deploymentCreationEvents.map((e) => e.entityId);
    const deployments =
      deploymentIds.length > 0
        ? await this.auditLogRepository
            .createQueryBuilder('audit')
            .where('audit.entityType = :entityType', { entityType: 'Deployment' })
            .andWhere('audit.entityId IN (:...deploymentIds)', { deploymentIds })
            .orderBy('audit.timestamp', 'ASC')
            .getMany()
        : [];

    // Get drift alerts and risk breaches for those deployments (single combined query)
    const driftAndRiskEvents =
      deploymentIds.length > 0
        ? await this.auditLogRepository
            .createQueryBuilder('audit')
            .where('audit.eventType IN (:...eventTypes)', { eventTypes: ['DRIFT_DETECTED', 'RISK_BREACH'] })
            .andWhere('audit.entityId IN (:...deploymentIds)', { deploymentIds })
            .orderBy('audit.timestamp', 'ASC')
            .getMany()
        : [];

    const driftAlerts = driftAndRiskEvents.filter((e) => e.eventType === 'DRIFT_DETECTED');
    const riskBreaches = driftAndRiskEvents.filter((e) => e.eventType === 'RISK_BREACH');

    // Create timeline
    const allEvents = [
      ...strategyEvents.map((e) => ({ ...e, category: 'strategy' })),
      ...backtestRuns.map((e) => ({ ...e, category: 'backtest' })),
      ...deployments.map((e) => ({ ...e, category: 'deployment' })),
      ...driftAlerts.map((e) => ({ ...e, category: 'drift' })),
      ...riskBreaches.map((e) => ({ ...e, category: 'risk' }))
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const timeline = allEvents.map((e) => ({
      timestamp: e.timestamp,
      category: e.category,
      eventType: e.eventType,
      entityType: e.entityType,
      entityId: e.entityId,
      summary: this.generateEventSummary(e)
    }));

    return {
      strategyEvents,
      backtestRuns,
      deployments,
      driftAlerts,
      riskBreaches,
      timeline
    };
  }

  /**
   * Get deployment audit trail with all related events
   */
  async getDeploymentAuditTrail(deploymentId: string): Promise<{
    deploymentEvents: AuditLog[];
    performanceSnapshots: PerformanceMetric[];
    driftAlerts: AuditLog[];
    riskBreaches: AuditLog[];
    allocationChanges: AuditLog[];
  }> {
    const deploymentEvents = await this.auditService.getEntityAuditTrail('Deployment', deploymentId);

    const driftAlerts = deploymentEvents.filter((e) => e.eventType === 'DRIFT_DETECTED');
    const riskBreaches = deploymentEvents.filter((e) => e.eventType === 'RISK_BREACH');
    const allocationChanges = deploymentEvents.filter((e) => e.eventType === 'ALLOCATION_ADJUSTED');

    const performanceSnapshots = await this.performanceMetricRepo.find({
      where: { deploymentId },
      order: { date: 'ASC' }
    });

    return {
      deploymentEvents,
      performanceSnapshots,
      driftAlerts,
      riskBreaches,
      allocationChanges
    };
  }

  /**
   * Reconstruct a complete workflow from correlation ID
   */
  async reconstructWorkflow(correlationId: string): Promise<{
    correlationId: string;
    events: AuditLog[];
    startTime: Date;
    endTime: Date;
    duration: number;
    eventCount: number;
    success: boolean;
    summary: string;
  }> {
    const events = await this.auditService.getCorrelatedEvents(correlationId);

    if (events.length === 0) {
      return {
        correlationId,
        events: [],
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        eventCount: 0,
        success: false,
        summary: 'No events found for this correlation ID'
      };
    }

    const startTime = events[0].timestamp;
    const endTime = events[events.length - 1].timestamp;
    const duration = endTime.getTime() - startTime.getTime();

    // Determine success by checking for error events
    const hasErrors = events.some((e) => e.eventType.includes('FAILED') || e.eventType.includes('ERROR'));
    const success = !hasErrors;

    const summary = this.generateWorkflowSummary(events);

    return {
      correlationId,
      events,
      startTime,
      endTime,
      duration,
      eventCount: events.length,
      success,
      summary
    };
  }

  /**
   * Get audit logs for compliance reporting
   */
  async getComplianceReport(
    startDate: Date,
    endDate: Date
  ): Promise<{
    period: { start: Date; end: Date };
    summary: { totalEvents: number; eventsByType: Record<string, number>; eventsByEntity: Record<string, number> };
    criticalEvents: AuditLog[];
    automatedDecisions: AuditLog[];
    manualInterventions: AuditLog[];
    integrityStatus: { verified: number; failed: string[] };
  }> {
    const logs = await this.auditLogRepository.find({
      where: {
        timestamp: Between(startDate, endDate)
      },
      order: { timestamp: 'ASC' }
    });

    // Compute statistics from already-fetched logs to avoid redundant DB queries
    const eventsByType: Record<string, number> = {};
    const eventsByEntity: Record<string, number> = {};
    for (const log of logs) {
      eventsByType[log.eventType] = (eventsByType[log.eventType] ?? 0) + 1;
      eventsByEntity[log.entityType] = (eventsByEntity[log.entityType] ?? 0) + 1;
    }
    const summary = { totalEvents: logs.length, eventsByType, eventsByEntity };

    // Identify critical events
    const criticalEventTypes = ['STRATEGY_DEMOTED', 'RISK_BREACH', 'DEPLOYMENT_TERMINATED'];
    const criticalEvents = logs.filter((log) => criticalEventTypes.includes(log.eventType));

    // Identify automated decisions (no userId = system-initiated)
    const automatedDecisions = logs.filter((log) => log.userId == null);

    // Identify manual interventions (has userId = user-initiated)
    const manualInterventions = logs.filter((log) => log.userId != null);

    // Verify integrity of all logs
    const integrityStatus = await this.auditService.verifyMultipleEntries(logs.map((l) => l.id));

    return {
      period: { start: startDate, end: endDate },
      summary,
      criticalEvents,
      automatedDecisions,
      manualInterventions,
      integrityStatus
    };
  }

  /**
   * Search audit logs with full-text search
   */
  async searchAuditLogs(searchTerm: string, limit = 100): Promise<AuditLog[]> {
    if (!searchTerm) {
      throw new BadRequestException('Search term is required');
    }

    if (searchTerm.length > 500) {
      throw new BadRequestException('Search term must not exceed 500 characters');
    }

    const escaped = escapeLikeWildcards(searchTerm);

    return await this.auditLogRepository
      .createQueryBuilder('audit')
      .where('audit.metadata::text ILIKE :searchTerm', { searchTerm: `%${escaped}%` })
      .orWhere('audit.afterState::text ILIKE :searchTerm', { searchTerm: `%${escaped}%` })
      .orWhere('audit.beforeState::text ILIKE :searchTerm', { searchTerm: `%${escaped}%` })
      .orderBy('audit.timestamp', 'DESC')
      .take(limit)
      .getMany();
  }

  /**
   * Get user activity summary
   */
  async getUserActivitySummary(
    userId: string,
    days = 30
  ): Promise<{
    userId: string;
    totalEvents: number;
    eventsByType: Record<string, number>;
    recentEvents: AuditLog[];
    mostActiveDay: { date: string; count: number };
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const events = await this.auditLogRepository.find({
      where: {
        userId,
        timestamp: Between(startDate, new Date())
      },
      order: { timestamp: 'DESC' }
    });

    const eventsByType: Record<string, number> = {};
    const eventsByDay: Record<string, number> = {};

    for (const event of events) {
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;

      const day = event.timestamp.toISOString().split('T')[0];
      eventsByDay[day] = (eventsByDay[day] || 0) + 1;
    }

    // Find most active day
    const mostActiveDay = Object.entries(eventsByDay).reduce(
      (max, [date, count]) => (count > max.count ? { date, count } : max),
      { date: '', count: 0 }
    );

    return {
      userId,
      totalEvents: events.length,
      eventsByType,
      recentEvents: events.slice(0, 10),
      mostActiveDay
    };
  }

  /**
   * Generate event summary for timeline
   */
  private generateEventSummary(event: AuditLog & { category: string }): string {
    const summaries = {
      STRATEGY_CREATED: 'Strategy configuration created',
      STRATEGY_MODIFIED: 'Strategy configuration modified',
      BACKTEST_COMPLETED: `Backtest completed with ${event.afterState?.totalTrades || 'N/A'} trades`,
      GATE_EVALUATION: event.afterState?.canPromote ? 'Passed promotion gates' : 'Failed promotion gates',
      STRATEGY_PROMOTED: 'Strategy promoted to live trading',
      DEPLOYMENT_ACTIVATED: 'Deployment activated',
      DEPLOYMENT_PAUSED: 'Deployment paused',
      DEPLOYMENT_RESUMED: 'Deployment resumed',
      DRIFT_DETECTED: `Drift detected: ${event.afterState?.driftType || 'unknown'}`,
      RISK_BREACH: `Risk breach: ${event.metadata?.breachType || 'unknown'}`,
      STRATEGY_DEMOTED: 'Strategy automatically demoted',
      DEPLOYMENT_TERMINATED: 'Deployment terminated',
      ALLOCATION_ADJUSTED: `Allocation adjusted: ${event.beforeState?.allocationPercent || '?'}% → ${event.afterState?.allocationPercent || '?'}%`
    };

    return summaries[event.eventType] || event.eventType;
  }

  /**
   * Generate workflow summary
   */
  private generateWorkflowSummary(events: AuditLog[]): string {
    if (events.length === 0) return 'No events';
    if (events.length === 1) return `Single event: ${events[0].eventType}`;

    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];

    return `Workflow: ${firstEvent.eventType} → ... (${events.length - 2} steps) ... → ${lastEvent.eventType}`;
  }
}
