import { Injectable } from '@nestjs/common';

import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';

@Injectable()
export class StrategyMetricsService {
  constructor(
    @InjectMetric('chansey_strategy_deployments_active')
    private readonly strategyDeploymentsActive: Gauge<string>,
    @InjectMetric('chansey_strategy_signals_total')
    private readonly strategySignalsTotal: Counter<string>,

    // Heartbeat
    @InjectMetric('chansey_strategy_heartbeat_age_seconds')
    private readonly strategyHeartbeatAge: Gauge<string>,
    @InjectMetric('chansey_strategy_heartbeat_total')
    private readonly strategyHeartbeatTotal: Counter<string>,
    @InjectMetric('chansey_strategy_heartbeat_failures')
    private readonly strategyHeartbeatFailures: Gauge<string>,
    @InjectMetric('chansey_strategy_health_score')
    private readonly strategyHealthScore: Gauge<string>,

    // Portfolio
    @InjectMetric('chansey_portfolio_total_value_usd')
    private readonly portfolioTotalValue: Gauge<string>,
    @InjectMetric('chansey_portfolio_assets_count')
    private readonly portfolioAssetsCount: Gauge<string>
  ) {}

  setStrategyDeploymentsActive(strategy: string, status: string, count: number): void {
    this.strategyDeploymentsActive.set({ strategy, status }, count);
  }

  recordStrategySignal(strategy: string, signalType: 'buy' | 'sell' | 'hold'): void {
    this.strategySignalsTotal.inc({ strategy, signal_type: signalType });
  }

  recordStrategyHeartbeat(strategy: string, status: 'success' | 'failed'): void {
    this.strategyHeartbeatTotal.inc({ strategy, status });
  }

  setStrategyHeartbeatAge(strategy: string, shadowStatus: string, ageSeconds: number): void {
    this.strategyHeartbeatAge.set({ strategy, shadow_status: shadowStatus }, ageSeconds);
  }

  setStrategyHeartbeatFailures(strategy: string, failures: number): void {
    this.strategyHeartbeatFailures.set({ strategy }, failures);
  }

  setStrategyHealthScore(strategy: string, shadowStatus: string, score: number): void {
    this.strategyHealthScore.set({ strategy, shadow_status: shadowStatus }, Math.max(0, Math.min(100, score)));
  }

  setPortfolioTotalValue(userId: string, valueUsd: number): void {
    this.portfolioTotalValue.set({ user_id: userId }, valueUsd);
  }

  setPortfolioAssetsCount(userId: string, exchange: string, count: number): void {
    this.portfolioAssetsCount.set({ user_id: userId, exchange }, count);
  }

  calculateAndSetHealthScore(
    strategy: string,
    shadowStatus: string,
    heartbeatAgeSeconds: number,
    failures: number,
    maxHeartbeatAge = 300
  ): void {
    let score = 100;

    if (heartbeatAgeSeconds > maxHeartbeatAge) {
      const ageRatio = Math.min(heartbeatAgeSeconds / (maxHeartbeatAge * 3), 1);
      score -= ageRatio * 40;
    }

    score -= Math.min(failures * 15, 60);

    this.setStrategyHealthScore(strategy, shadowStatus, score);
  }
}
