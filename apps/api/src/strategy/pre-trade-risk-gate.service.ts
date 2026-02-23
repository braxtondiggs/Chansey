import { Injectable, Logger } from '@nestjs/common';

import { DeploymentStatus } from '@chansey/api-interfaces';

import { DeploymentService } from './deployment.service';

/**
 * Pre-trade drawdown gate for live trading.
 *
 * Blocks BUY signals when a strategy's active deployment has breached
 * its max drawdown limit. SELL signals always pass so positions can unwind.
 *
 * This closes the gap between the 2-minute trading cron and the hourly
 * risk management check, preventing new positions during drawdown breach.
 */
@Injectable()
export class PreTradeRiskGateService {
  private readonly logger = new Logger(PreTradeRiskGateService.name);

  constructor(private readonly deploymentService: DeploymentService) {}

  async checkDrawdown(
    strategyConfigId: string,
    action: 'buy' | 'sell'
  ): Promise<{ allowed: boolean; reason?: string }> {
    // SELLs always allowed — must be able to unwind positions
    if (action === 'sell') {
      return { allowed: true };
    }

    const deployments = await this.deploymentService.findByStrategy(strategyConfigId);
    const activeDeployment = deployments.find((d) => d.status === DeploymentStatus.ACTIVE);

    if (!activeDeployment) {
      return { allowed: true };
    }

    const currentDrawdown = Number(activeDeployment.currentDrawdown);
    const maxDrawdownLimit = Number(activeDeployment.maxDrawdownLimit);

    if (currentDrawdown >= maxDrawdownLimit) {
      const reason =
        `Drawdown gate blocked BUY: current drawdown ${(currentDrawdown * 100).toFixed(1)}% ` +
        `>= limit ${(maxDrawdownLimit * 100).toFixed(1)}%`;
      this.logger.warn(`${reason} (strategy ${strategyConfigId})`);
      return { allowed: false, reason };
    }

    return { allowed: true };
  }
}
