import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  BacktestCompletedEvent,
  OptimizationCompletedEvent,
  PIPELINE_EVENTS,
  PaperTradingCompletedEvent
} from '../interfaces';
import { PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';

@Injectable()
export class PipelineEventListener {
  private readonly logger = new Logger(PipelineEventListener.name);

  constructor(private readonly orchestratorService: PipelineOrchestratorService) {}

  /**
   * Handle optimization completion event
   */
  @OnEvent(PIPELINE_EVENTS.OPTIMIZATION_COMPLETED, { async: true })
  async handleOptimizationComplete(payload: OptimizationCompletedEvent): Promise<void> {
    this.logger.log(
      `Received optimization.completed event for run ${payload.runId} ` + `(strategy ${payload.strategyConfigId})`
    );

    try {
      await this.orchestratorService.handleOptimizationComplete(
        payload.runId,
        payload.strategyConfigId,
        payload.bestParameters,
        payload.bestScore,
        payload.improvement
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle optimization completion for run ${payload.runId}: ${error.message}`,
        error.stack
      );
    }
  }

  /**
   * Handle backtest completion event
   */
  @OnEvent(PIPELINE_EVENTS.BACKTEST_COMPLETED, { async: true })
  async handleBacktestComplete(payload: BacktestCompletedEvent): Promise<void> {
    this.logger.log(`Received backtest.completed event for backtest ${payload.backtestId} (type: ${payload.type})`);

    try {
      await this.orchestratorService.handleBacktestComplete(payload.backtestId, payload.type, payload.metrics);
    } catch (error) {
      this.logger.error(
        `Failed to handle backtest completion for ${payload.backtestId}: ${error.message}`,
        error.stack
      );
    }
  }

  /**
   * Handle paper trading completion event
   */
  @OnEvent(PIPELINE_EVENTS.PAPER_TRADING_COMPLETED, { async: true })
  async handlePaperTradingComplete(payload: PaperTradingCompletedEvent): Promise<void> {
    // Only process if this is part of a pipeline
    if (!payload.pipelineId) {
      return;
    }

    this.logger.log(
      `Received paper-trading.completed event for session ${payload.sessionId} ` + `(pipeline ${payload.pipelineId})`
    );

    try {
      await this.orchestratorService.handlePaperTradingComplete(
        payload.sessionId,
        payload.pipelineId,
        payload.metrics,
        payload.stoppedReason
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle paper trading completion for session ${payload.sessionId}: ${error.message}`,
        error.stack
      );
    }
  }
}
