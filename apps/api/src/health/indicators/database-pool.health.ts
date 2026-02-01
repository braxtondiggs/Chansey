import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { DataSource } from 'typeorm';

interface PoolStats {
  activeConnections: number;
  idleConnections: number;
  maxConnections: number;
  usagePercent: number;
}

/**
 * Health indicator that monitors PostgreSQL connection pool health via pg_stat_activity.
 * Tracks active connections, idle connections, and usage percentage.
 */
@Injectable()
export class DatabasePoolHealthIndicator {
  private readonly logger = new Logger(DatabasePoolHealthIndicator.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly healthIndicatorService: HealthIndicatorService
  ) {}

  /**
   * Check database connection pool health
   * Fails if connection usage exceeds 80%
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const stats = await this.getPoolStats();

      const result = {
        activeConnections: stats.activeConnections,
        idleConnections: stats.idleConnections,
        maxConnections: stats.maxConnections,
        usagePercent: stats.usagePercent
      };

      // Fail if usage exceeds 80%
      if (stats.usagePercent > 80) {
        return indicator.down({ ...result, message: 'Connection pool usage exceeds 80%' });
      }

      return indicator.up(result);
    } catch (error) {
      this.logger.error(`Database pool health check failed: ${error.message}`);
      return indicator.down({ error: error.message });
    }
  }

  private async getPoolStats(): Promise<PoolStats> {
    // Get active and idle connections from pg_stat_activity
    const activityResult = await this.dataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE state = 'active') as active_count,
        COUNT(*) FILTER (WHERE state = 'idle') as idle_count,
        COUNT(*) as total_count
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);

    // Get max_connections setting
    const maxResult = await this.dataSource.query(`SHOW max_connections`);

    const activeConnections = parseInt(activityResult[0]?.active_count || '0', 10);
    const idleConnections = parseInt(activityResult[0]?.idle_count || '0', 10);
    const totalConnections = parseInt(activityResult[0]?.total_count || '0', 10);
    const maxConnections = parseInt(maxResult[0]?.max_connections || '100', 10);

    const usagePercent = maxConnections > 0 ? Math.round((totalConnections / maxConnections) * 100) : 0;

    return {
      activeConnections,
      idleConnections,
      maxConnections,
      usagePercent
    };
  }
}
