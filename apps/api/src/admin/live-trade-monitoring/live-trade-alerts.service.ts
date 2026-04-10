import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AlertsDto, AlertSeverity, AlertType, PerformanceAlertDto } from './dto/alerts.dto';
import { LiveTradeFiltersDto } from './dto/filters.dto';
import {
  calculateDeviationPercent,
  DEFAULT_THRESHOLDS,
  latestPerformanceCondition
} from './live-trade-monitoring.utils';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { AlgorithmPerformance } from '../../algorithm/algorithm-performance.entity';
import { Backtest, BacktestStatus } from '../../order/backtest/backtest.entity';

export interface AlertBaseData {
  activations: AlgorithmActivation[];
  perfMap: Map<string, AlgorithmPerformance>;
  backtestMap: Map<string, Backtest>;
}

@Injectable()
export class LiveTradeAlertsService {
  constructor(
    @InjectRepository(AlgorithmActivation)
    private readonly activationRepo: Repository<AlgorithmActivation>,
    @InjectRepository(AlgorithmPerformance)
    private readonly performanceRepo: Repository<AlgorithmPerformance>,
    @InjectRepository(Backtest)
    private readonly backtestRepo: Repository<Backtest>
  ) {}

  async getAlerts(filters: LiveTradeFiltersDto): Promise<AlertsDto> {
    const alerts = await this.generateAllAlerts(filters);

    const criticalCount = alerts.filter((a) => a.severity === AlertSeverity.CRITICAL).length;
    const warningCount = alerts.filter((a) => a.severity === AlertSeverity.WARNING).length;
    const infoCount = alerts.filter((a) => a.severity === AlertSeverity.INFO).length;

    return {
      alerts,
      total: alerts.length,
      criticalCount,
      warningCount,
      infoCount,
      thresholds: DEFAULT_THRESHOLDS,
      lastCalculatedAt: new Date().toISOString()
    };
  }

  /**
   * Fetch base data needed for alert generation.
   * @param includeUser Whether to load user relations (needed for full alerts, not for counting)
   */
  async fetchAlertBaseData(filters: LiveTradeFiltersDto, includeUser: boolean): Promise<AlertBaseData> {
    const emptyResult: AlertBaseData = {
      activations: [],
      perfMap: new Map<string, AlgorithmPerformance>(),
      backtestMap: new Map<string, Backtest>()
    };

    const activationQb = this.activationRepo
      .createQueryBuilder('aa')
      .leftJoinAndSelect('aa.algorithm', 'algorithm')
      .where('aa.isActive = :isActive', { isActive: true });

    if (includeUser) {
      activationQb.leftJoinAndSelect('aa.user', 'user');
    }
    if (filters.algorithmId) {
      activationQb.andWhere('aa.algorithmId = :algorithmId', { algorithmId: filters.algorithmId });
    }
    if (filters.userId) {
      activationQb.andWhere('aa.userId = :userId', { userId: filters.userId });
    }

    const filteredActivations = await activationQb.getMany();

    if (filteredActivations.length === 0) return emptyResult;

    const activationIds = filteredActivations.map((a) => a.id);
    const performances = await this.performanceRepo
      .createQueryBuilder('ap')
      .where('ap.algorithmActivationId IN (:...activationIds)', { activationIds })
      .andWhere(latestPerformanceCondition('ap'))
      .getMany();

    const perfMap = new Map<string, AlgorithmPerformance>();
    for (const p of performances) {
      perfMap.set(p.algorithmActivationId, p);
    }

    const algorithmIds = [...new Set(filteredActivations.map((a) => a.algorithmId))];
    const backtests = await this.backtestRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.algorithm', 'a')
      .where('a.id IN (:...algorithmIds)', { algorithmIds })
      .andWhere('b.status = :status', { status: BacktestStatus.COMPLETED })
      .andWhere(
        'b.completedAt = (SELECT MAX(b2."completedAt") FROM backtests b2 WHERE b2."algorithmId" = a.id AND b2.status = :completedStatus)'
      )
      .setParameter('status', BacktestStatus.COMPLETED)
      .setParameter('completedStatus', BacktestStatus.COMPLETED)
      .getMany();

    const backtestMap = new Map<string, Backtest>();
    for (const b of backtests) {
      backtestMap.set(b.algorithm.id, b);
    }

    return { activations: filteredActivations, perfMap, backtestMap };
  }

  generateAlertsForActivation(
    activation: AlgorithmActivation,
    performance: AlgorithmPerformance | null,
    backtest: Backtest | null
  ): PerformanceAlertDto[] {
    const alerts: PerformanceAlertDto[] = [];
    const now = new Date().toISOString();

    if (!performance) {
      alerts.push({
        id: `${activation.id}-no-perf`,
        type: AlertType.NO_ORDERS,
        severity: AlertSeverity.INFO,
        title: 'No Performance Data',
        message: `Algorithm "${activation.algorithm?.name}" has no performance data yet`,
        algorithmId: activation.algorithmId,
        algorithmName: activation.algorithm?.name || 'Unknown',
        algorithmActivationId: activation.id,
        userId: activation.userId,
        userEmail: activation.user?.email,
        liveValue: 0,
        threshold: 0,
        deviationPercent: 0,
        createdAt: now
      });
      return alerts;
    }

    if (backtest) {
      if (performance.sharpeRatio != null && backtest.sharpeRatio != null) {
        const liveSharpe = performance.sharpeRatio;
        const btSharpe = backtest.sharpeRatio;
        const deviation = calculateDeviationPercent(liveSharpe, btSharpe);
        if (deviation < -DEFAULT_THRESHOLDS.sharpeRatioCritical) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.SHARPE_RATIO_LOW,
              AlertSeverity.CRITICAL,
              'Sharpe Ratio Critical',
              liveSharpe,
              btSharpe,
              DEFAULT_THRESHOLDS.sharpeRatioCritical,
              deviation
            )
          );
        } else if (deviation < -DEFAULT_THRESHOLDS.sharpeRatioWarning) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.SHARPE_RATIO_LOW,
              AlertSeverity.WARNING,
              'Sharpe Ratio Below Expected',
              liveSharpe,
              btSharpe,
              DEFAULT_THRESHOLDS.sharpeRatioWarning,
              deviation
            )
          );
        }
      }

      if (performance.winRate != null && backtest.winRate != null) {
        const liveWinRate = performance.winRate;
        const btWinRate = backtest.winRate;
        const deviation = calculateDeviationPercent(liveWinRate, btWinRate);
        if (deviation < -DEFAULT_THRESHOLDS.winRateCritical) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.WIN_RATE_LOW,
              AlertSeverity.CRITICAL,
              'Win Rate Critical',
              liveWinRate,
              btWinRate,
              DEFAULT_THRESHOLDS.winRateCritical,
              deviation
            )
          );
        } else if (deviation < -DEFAULT_THRESHOLDS.winRateWarning) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.WIN_RATE_LOW,
              AlertSeverity.WARNING,
              'Win Rate Below Expected',
              liveWinRate,
              btWinRate,
              DEFAULT_THRESHOLDS.winRateWarning,
              deviation
            )
          );
        }
      }

      if (performance.maxDrawdown != null && backtest.maxDrawdown != null) {
        const liveDrawdown = performance.maxDrawdown;
        const btDrawdown = backtest.maxDrawdown;
        const deviation = calculateDeviationPercent(liveDrawdown, btDrawdown);
        if (deviation > DEFAULT_THRESHOLDS.maxDrawdownCritical) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.DRAWDOWN_HIGH,
              AlertSeverity.CRITICAL,
              'Max Drawdown Critical',
              liveDrawdown,
              btDrawdown,
              DEFAULT_THRESHOLDS.maxDrawdownCritical,
              deviation
            )
          );
        } else if (deviation > DEFAULT_THRESHOLDS.maxDrawdownWarning) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.DRAWDOWN_HIGH,
              AlertSeverity.WARNING,
              'Max Drawdown Above Expected',
              liveDrawdown,
              btDrawdown,
              DEFAULT_THRESHOLDS.maxDrawdownWarning,
              deviation
            )
          );
        }
      }

      if (performance.roi != null && backtest.totalReturn != null) {
        const liveRoi = performance.roi;
        const btReturn = backtest.totalReturn;
        const deviation = calculateDeviationPercent(liveRoi, btReturn);
        if (deviation < -DEFAULT_THRESHOLDS.totalReturnCritical) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.RETURN_LOW,
              AlertSeverity.CRITICAL,
              'Return Critical',
              liveRoi,
              btReturn,
              DEFAULT_THRESHOLDS.totalReturnCritical,
              deviation
            )
          );
        } else if (deviation < -DEFAULT_THRESHOLDS.totalReturnWarning) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.RETURN_LOW,
              AlertSeverity.WARNING,
              'Return Below Expected',
              liveRoi,
              btReturn,
              DEFAULT_THRESHOLDS.totalReturnWarning,
              deviation
            )
          );
        }
      }
    }

    return alerts;
  }

  private async generateAllAlerts(filters: LiveTradeFiltersDto): Promise<PerformanceAlertDto[]> {
    const { activations, perfMap, backtestMap } = await this.fetchAlertBaseData(filters, true);

    const alerts: PerformanceAlertDto[] = [];
    for (const activation of activations) {
      const performance = perfMap.get(activation.id) || null;
      const backtest = backtestMap.get(activation.algorithmId) || null;

      const activationAlerts = this.generateAlertsForActivation(activation, performance, backtest);
      alerts.push(...activationAlerts);
    }

    const severityOrder = { [AlertSeverity.CRITICAL]: 0, [AlertSeverity.WARNING]: 1, [AlertSeverity.INFO]: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return alerts;
  }

  private createAlert(
    activation: AlgorithmActivation,
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    liveValue: number,
    backtestValue: number,
    threshold: number,
    deviation: number
  ): PerformanceAlertDto {
    return {
      id: `${activation.id}-${type}`,
      type,
      severity,
      title,
      message: `Live value: ${liveValue?.toFixed(2)}, Backtest: ${backtestValue?.toFixed(2)}, Deviation: ${deviation?.toFixed(1)}%`,
      algorithmId: activation.algorithmId,
      algorithmName: activation.algorithm?.name || 'Unknown',
      algorithmActivationId: activation.id,
      userId: activation.userId,
      userEmail: activation.user?.email,
      liveValue,
      backtestValue,
      threshold,
      deviationPercent: deviation,
      createdAt: new Date().toISOString()
    };
  }
}
