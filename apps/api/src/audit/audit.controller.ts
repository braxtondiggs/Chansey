import { Controller, Get, Post, Query, Param, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';

import { AuditTrailQuery, Role } from '@chansey/api-interfaces';

import { AuditQueryService } from './audit-query.service';
import { AuditService } from './audit.service';

import { Roles } from '../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';

/**
 * AuditController
 *
 * REST API for querying and analyzing audit trails.
 *
 * All endpoints require authentication. Admin-only endpoints are marked with @Roles(Role.ADMIN).
 *
 * Features:
 * - Query audit logs with flexible filtering
 * - Strategy lifecycle reconstruction
 * - Deployment audit trails
 * - Workflow reconstruction from correlation IDs
 * - Compliance reporting
 * - Full-text search
 * - User activity tracking
 * - Audit log integrity verification
 */
@Controller('audit')
@UseGuards(JwtAuthenticationGuard, RolesGuard)
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly auditQueryService: AuditQueryService
  ) {}

  /**
   * Query audit trail with filters
   *
   * GET /audit/logs?entityType=StrategyConfig&startDate=2024-01-01&limit=50
   *
   * Supports filtering by:
   * - entityType, entityId
   * - eventType (single or array)
   * - userId
   * - startDate, endDate
   * - correlationId
   * - pagination (limit, offset)
   */
  @Get('logs')
  @Roles(Role.ADMIN)
  async queryAuditTrail(@Query() query: AuditTrailQuery) {
    return this.auditService.queryAuditTrail(query);
  }

  /**
   * Get complete audit trail for a specific entity
   *
   * GET /audit/entity/StrategyConfig/abc-123
   */
  @Get('entity/:entityType/:entityId')
  async getEntityAuditTrail(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query('limit') limit?: number
  ) {
    return this.auditService.getEntityAuditTrail(entityType, entityId, limit);
  }

  /**
   * Get all correlated events for a workflow
   *
   * GET /audit/workflow/correlation-id-123
   *
   * Returns all events with the same correlation ID, ordered chronologically
   */
  @Get('workflow/:correlationId')
  async getCorrelatedEvents(@Param('correlationId') correlationId: string) {
    return this.auditService.getCorrelatedEvents(correlationId);
  }

  /**
   * Reconstruct complete workflow from correlation ID
   *
   * GET /audit/workflow/:correlationId/reconstruct
   *
   * Returns:
   * - All events in the workflow
   * - Start/end times and duration
   * - Success/failure status
   * - Workflow summary
   */
  @Get('workflow/:correlationId/reconstruct')
  async reconstructWorkflow(@Param('correlationId') correlationId: string) {
    return this.auditQueryService.reconstructWorkflow(correlationId);
  }

  /**
   * Get complete strategy lifecycle
   *
   * GET /audit/strategy/:strategyConfigId/lifecycle
   *
   * Returns:
   * - All strategy events (creation, modifications)
   * - All backtest runs
   * - All deployments
   * - All drift alerts
   * - All risk breaches
   * - Complete timeline of all events
   */
  @Get('strategy/:strategyConfigId/lifecycle')
  async getStrategyLifecycle(@Param('strategyConfigId') strategyConfigId: string) {
    return this.auditQueryService.getStrategyLifecycle(strategyConfigId);
  }

  /**
   * Get deployment audit trail with performance analysis
   *
   * GET /audit/deployment/:deploymentId/trail
   *
   * Returns:
   * - All deployment events
   * - Performance snapshots
   * - Drift alerts
   * - Risk breaches
   * - Allocation changes
   */
  @Get('deployment/:deploymentId/trail')
  async getDeploymentAuditTrail(@Param('deploymentId') deploymentId: string) {
    return this.auditQueryService.getDeploymentAuditTrail(deploymentId);
  }

  /**
   * Generate compliance report for date range
   *
   * GET /audit/compliance?startDate=2024-01-01&endDate=2024-12-31
   *
   * Returns:
   * - Summary statistics
   * - Critical events (demotions, risk breaches, terminations)
   * - Automated decisions (system user)
   * - Manual interventions (non-system users)
   * - Audit log integrity status
   */
  @Get('compliance')
  @Roles(Role.ADMIN)
  async getComplianceReport(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.auditQueryService.getComplianceReport(new Date(startDate), new Date(endDate));
  }

  /**
   * Search audit logs with full-text search
   *
   * GET /audit/search?q=sharpe+ratio&limit=50
   *
   * Searches across metadata, beforeState, and afterState fields
   */
  @Get('search')
  @Roles(Role.ADMIN)
  async searchAuditLogs(@Query('q') searchTerm: string, @Query('limit') limit?: number) {
    return this.auditQueryService.searchAuditLogs(searchTerm, limit);
  }

  /**
   * Get user activity summary
   *
   * GET /audit/user/:userId/activity?days=30
   *
   * Returns:
   * - Total events count
   * - Events grouped by type
   * - Recent events
   * - Most active day
   */
  @Get('user/:userId/activity')
  @Roles(Role.ADMIN)
  async getUserActivitySummary(@Param('userId') userId: string, @Query('days') days?: number) {
    return this.auditQueryService.getUserActivitySummary(userId, days ? parseInt(days.toString()) : 30);
  }

  /**
   * Get audit statistics for date range
   *
   * GET /audit/statistics?startDate=2024-01-01&endDate=2024-12-31
   *
   * Returns:
   * - Total events count
   * - Events grouped by type
   * - Events grouped by entity type
   */
  @Get('statistics')
  @Roles(Role.ADMIN)
  async getAuditStatistics(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.auditService.getAuditStatistics(new Date(startDate), new Date(endDate));
  }

  /**
   * Verify integrity of specific audit log entries
   *
   * POST /audit/verify
   * Body: { auditLogIds: ["id1", "id2", "id3"] }
   *
   * Returns:
   * - Number of verified entries
   * - List of failed entry IDs
   */
  @Post('verify')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async verifyAuditLogIntegrity(@Body() body: { auditLogIds: string[] }) {
    return this.auditService.verifyMultipleEntries(body.auditLogIds);
  }

  /**
   * Verify integrity of all audit logs in date range
   *
   * POST /audit/verify/range
   * Body: { startDate: "2024-01-01", endDate: "2024-12-31" }
   *
   * Returns:
   * - Number of verified entries
   * - List of failed entry IDs
   * - Integrity percentage
   */
  @Post('verify/range')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async verifyAuditLogRange(@Body() body: { startDate: string; endDate: string }) {
    const { logs } = await this.auditService.queryAuditTrail({
      startDate: body.startDate,
      endDate: body.endDate,
      limit: 10000 // Verify up to 10k entries at once
    });

    const auditLogIds = logs.map((log) => log.id);
    const result = await this.auditService.verifyMultipleEntries(auditLogIds);

    return {
      ...result,
      total: logs.length,
      integrityPercentage: logs.length > 0 ? (result.verified / logs.length) * 100 : 100
    };
  }
}
