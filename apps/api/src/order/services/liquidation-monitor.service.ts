import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { MAINTENANCE_MARGIN_RATE, PositionSide as PositionSideEnum } from '@chansey/api-interfaces';

import { CoinService } from '../../coin/coin.service';
import { UserStrategyPosition } from '../../strategy/entities/user-strategy-position.entity';

export interface LiquidationRisk {
  positionId: string;
  userId: string;
  symbol: string;
  positionSide: string;
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  liquidationPrice: number;
  distanceToLiquidation: number;
  riskLevel: 'SAFE' | 'WARNING' | 'CRITICAL';
}

export interface MarginHealth {
  userId: string;
  totalMarginUsed: number;
  availableMargin: number;
  marginUtilization: number;
  positionsAtRisk: LiquidationRisk[];
}

@Injectable()
export class LiquidationMonitorService {
  private readonly logger = new Logger(LiquidationMonitorService.name);

  constructor(
    @InjectRepository(UserStrategyPosition)
    private readonly positionRepo: Repository<UserStrategyPosition>,
    private readonly coinService: CoinService
  ) {}

  async countLeveragedPositions(): Promise<number> {
    return this.positionRepo.createQueryBuilder('p').where('p.leverage > 1').andWhere('p.quantity > 0').getCount();
  }

  async checkLiquidationRisk(): Promise<LiquidationRisk[]> {
    const leveragedPositions = await this.positionRepo
      .createQueryBuilder('p')
      .where('p.leverage > 1')
      .andWhere('p.quantity > 0')
      .getMany();

    if (leveragedPositions.length === 0) return [];

    const priceMap = await this.batchFetchPrices(leveragedPositions);

    return this.evaluatePositionRisks(leveragedPositions, priceMap);
  }

  async calculateMarginHealth(userId: string): Promise<MarginHealth> {
    const positions = await this.positionRepo
      .createQueryBuilder('p')
      .where('p.userId = :userId', { userId })
      .andWhere('p.leverage > 1')
      .andWhere('p.quantity > 0')
      .getMany();

    const totalMarginUsed = positions.reduce((sum, p) => sum + (Number(p.marginAmount) || 0), 0);

    const priceMap = await this.batchFetchPrices(positions);
    const risks = this.evaluatePositionRisks(positions, priceMap);

    return {
      userId,
      totalMarginUsed,
      availableMargin: 0,
      marginUtilization: 0,
      positionsAtRisk: risks.filter((r) => r.riskLevel !== 'SAFE')
    };
  }

  private async batchFetchPrices(positions: UserStrategyPosition[]): Promise<Map<string, number>> {
    const uniqueSymbols = [...new Set(positions.map((p) => p.symbol))];
    const priceMap = new Map<string, number>();

    await Promise.all(
      uniqueSymbols.map(async (symbol) => {
        const price = await this.getCurrentPrice(symbol);
        if (price !== null) {
          priceMap.set(symbol, price);
        }
      })
    );

    return priceMap;
  }

  private evaluatePositionRisks(positions: UserStrategyPosition[], priceMap: Map<string, number>): LiquidationRisk[] {
    const risks: LiquidationRisk[] = [];

    for (const position of positions) {
      try {
        const currentPrice = priceMap.get(position.symbol);
        if (!currentPrice) continue;

        const liquidationPrice = position.liquidationPrice
          ? Number(position.liquidationPrice)
          : this.calculateLiquidationPrice(
              Number(position.avgEntryPrice),
              Number(position.leverage),
              position.positionSide
            );

        let distanceToLiquidation: number;
        if (position.positionSide === PositionSideEnum.SHORT) {
          distanceToLiquidation = (liquidationPrice - currentPrice) / currentPrice;
        } else {
          distanceToLiquidation = (currentPrice - liquidationPrice) / currentPrice;
        }

        let riskLevel: LiquidationRisk['riskLevel'] = 'SAFE';
        if (distanceToLiquidation <= 0.02) {
          riskLevel = 'CRITICAL';
        } else if (distanceToLiquidation <= 0.05) {
          riskLevel = 'WARNING';
        }

        const risk: LiquidationRisk = {
          positionId: position.id,
          userId: position.userId,
          symbol: position.symbol,
          positionSide: position.positionSide,
          leverage: Number(position.leverage),
          entryPrice: Number(position.avgEntryPrice),
          currentPrice,
          liquidationPrice,
          distanceToLiquidation,
          riskLevel
        };

        risks.push(risk);

        if (riskLevel === 'CRITICAL') {
          this.logger.warn(
            `CRITICAL liquidation risk: ${position.symbol} ${position.positionSide} ` +
              `distance=${(distanceToLiquidation * 100).toFixed(2)}% user=${position.userId}`
          );
        } else if (riskLevel === 'WARNING') {
          this.logger.warn(
            `WARNING liquidation risk: ${position.symbol} ${position.positionSide} ` +
              `distance=${(distanceToLiquidation * 100).toFixed(2)}% user=${position.userId}`
          );
        }
      } catch (error) {
        this.logger.error(`Error checking liquidation for position ${position.id}: ${error}`);
      }
    }

    return risks;
  }

  private calculateLiquidationPrice(entryPrice: number, leverage: number, side: string): number {
    const mmr = MAINTENANCE_MARGIN_RATE;
    if (side === PositionSideEnum.SHORT) {
      return entryPrice * (1 + 1 / leverage - mmr);
    }
    return entryPrice * (1 - 1 / leverage + mmr);
  }

  private async getCurrentPrice(symbol: string): Promise<number | null> {
    try {
      const baseSymbol = symbol.replace(/USDT$|USD$|BUSD$/i, '').replace(/\/.*$/, '');
      const coin = await this.coinService.getCoinBySymbol(baseSymbol, undefined, false);
      return coin?.currentPrice ?? null;
    } catch {
      return null;
    }
  }
}
