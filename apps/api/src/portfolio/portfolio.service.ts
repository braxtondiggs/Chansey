import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { CreatePortfolioDto, UpdatePortfolioDto } from './dto';
import { PortfolioType } from './portfolio-type.enum';
import { Portfolio, PortfolioRelations } from './portfolio.entity';
import { PortfolioHistoricalPriceTask } from './tasks/portfolio-historical-price.task';

import { Coin } from '../coin/coin.entity';
import { PriceService } from '../price/price.service';
import { User } from '../users/users.entity';
import { NotFoundCustomException } from '../utils/filters/not-found.exception';

@Injectable()
export class PortfolioService {
  constructor(
    @InjectRepository(Portfolio) private readonly portfolio: Repository<Portfolio>,
    private readonly portfolioHistoricalPriceTask: PortfolioHistoricalPriceTask,
    @Inject(forwardRef(() => PriceService)) private readonly priceService: PriceService
  ) {}

  async getPortfolio(): Promise<Portfolio[]> {
    return await this.portfolio.find({
      relations: ['coin']
    });
  }

  async getPortfolioCoins(): Promise<Coin[]> {
    const portfolios = await this.getPortfolio();
    return [...new Set(portfolios.map(({ coin }) => coin))];
  }

  async getPortfolioById(portfolioId: string, userId: string): Promise<Portfolio> {
    const portfolio = await this.portfolio.findOne({
      where: { id: portfolioId, user: { id: userId } },
      relations: ['coin']
    });
    if (!portfolio) throw new NotFoundCustomException('Portfolio', { id: portfolioId });
    return portfolio;
  }

  async getPortfolioByUser(user: User, relations?: PortfolioRelations[], type?: PortfolioType): Promise<Portfolio[]> {
    const whereConditions: { user: { id: string }; type?: PortfolioType } = {
      user: {
        id: user.id
      }
    };

    if (type) {
      whereConditions.type = type;
    }

    const portfolio = await this.portfolio.find({
      where: whereConditions,
      relations
    });
    if (!portfolio) throw new NotFoundCustomException('Portfolio', { user: user.id });
    return portfolio;
  }

  async createPortfolioItem(portfolioDto: CreatePortfolioDto, user: User): Promise<Portfolio> {
    // Check if portfolio item already exists for this user, coin, and type
    const existingPortfolio = await this.portfolio.findOne({
      where: {
        coin: {
          id: portfolioDto.coinId
        },
        user: {
          id: user.id
        },
        type: portfolioDto.type
      }
    });

    if (existingPortfolio) {
      return existingPortfolio;
    }

    // Create new portfolio item
    const newPortfolio = this.portfolio.create({
      coin: { id: portfolioDto.coinId },
      user,
      type: portfolioDto.type
    });

    const savedPortfolio = await this.portfolio.save(newPortfolio);

    // Trigger historical price data fetching for the new portfolio item
    // This happens asynchronously in the background via BullMQ
    try {
      // Check if there are at least 100 prices in the database before queuing job
      const priceCount = await this.priceService.getPriceCount();
      if (priceCount >= 100) {
        await this.portfolioHistoricalPriceTask.addHistoricalPriceJob(portfolioDto.coinId);
      } else {
        console.log(
          `Skipping historical price job for coin ${portfolioDto.coinId}: only ${priceCount} prices in database (minimum 100 required)`
        );
      }
    } catch (error) {
      // Log error but don't fail the portfolio creation
      console.error(`Failed to queue historical price job for coin ${portfolioDto.coinId}:`, error);
    }

    return savedPortfolio;
  }

  async updatePortfolioItem(portfolioId: string, userId: string, dto: UpdatePortfolioDto): Promise<Portfolio> {
    const data = await this.getPortfolioById(portfolioId, userId);
    if (!data) throw new NotFoundCustomException('Portfolio', { id: portfolioId });
    return await this.portfolio.save(new Portfolio({ ...data, ...dto }));
  }

  async deletePortfolioItem(portfolioId: string, userId: string) {
    const response = await this.portfolio.delete({
      id: portfolioId,
      user: {
        id: userId
      }
    });
    if (!response.affected) throw new NotFoundCustomException('Portfolio', { id: portfolioId });
    return response;
  }
}
