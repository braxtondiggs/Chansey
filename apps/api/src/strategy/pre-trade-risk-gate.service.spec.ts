import { Test, TestingModule } from '@nestjs/testing';

import { DeploymentStatus } from '@chansey/api-interfaces';

import { DeploymentService } from './deployment.service';
import { Deployment } from './entities/deployment.entity';
import { PreTradeRiskGateService } from './pre-trade-risk-gate.service';

describe('PreTradeRiskGateService', () => {
  let service: PreTradeRiskGateService;
  let deploymentService: jest.Mocked<DeploymentService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreTradeRiskGateService,
        {
          provide: DeploymentService,
          useValue: { findByStrategy: jest.fn() }
        }
      ]
    }).compile();

    service = module.get(PreTradeRiskGateService);
    deploymentService = module.get(DeploymentService) as jest.Mocked<DeploymentService>;
  });

  function makeDeployment(overrides: Partial<Deployment> = {}): Deployment {
    return {
      id: 'deploy-1',
      strategyConfigId: 'strat-1',
      status: DeploymentStatus.ACTIVE,
      currentDrawdown: 0.1,
      maxDrawdownLimit: 0.2,
      ...overrides
    } as Deployment;
  }

  it('should always allow SELL signals', async () => {
    // Don't even set up deployment — SELL should short-circuit
    const result = await service.checkDrawdown('strat-1', 'sell');
    expect(result.allowed).toBe(true);
    expect(deploymentService.findByStrategy).not.toHaveBeenCalled();
  });

  it('should allow BUY when currentDrawdown < maxDrawdownLimit', async () => {
    deploymentService.findByStrategy.mockResolvedValue([
      makeDeployment({ currentDrawdown: 0.1, maxDrawdownLimit: 0.2 })
    ]);

    const result = await service.checkDrawdown('strat-1', 'buy');
    expect(result.allowed).toBe(true);
  });

  it('should block BUY when currentDrawdown >= maxDrawdownLimit', async () => {
    deploymentService.findByStrategy.mockResolvedValue([
      makeDeployment({ currentDrawdown: 0.25, maxDrawdownLimit: 0.2 })
    ]);

    const result = await service.checkDrawdown('strat-1', 'buy');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Drawdown gate blocked BUY');
    expect(result.reason).toContain('25.0%');
    expect(result.reason).toContain('20.0%');
  });

  it('should block BUY when drawdown is exactly at the limit', async () => {
    deploymentService.findByStrategy.mockResolvedValue([
      makeDeployment({ currentDrawdown: 0.2, maxDrawdownLimit: 0.2 })
    ]);

    const result = await service.checkDrawdown('strat-1', 'buy');
    expect(result.allowed).toBe(false);
  });

  it('should allow BUY when no active deployment exists', async () => {
    deploymentService.findByStrategy.mockResolvedValue([]);

    const result = await service.checkDrawdown('strat-1', 'buy');
    expect(result.allowed).toBe(true);
  });

  it('should ignore non-active deployments', async () => {
    deploymentService.findByStrategy.mockResolvedValue([
      makeDeployment({ status: DeploymentStatus.DEMOTED, currentDrawdown: 0.5, maxDrawdownLimit: 0.2 })
    ]);

    const result = await service.checkDrawdown('strat-1', 'buy');
    expect(result.allowed).toBe(true);
  });
});
