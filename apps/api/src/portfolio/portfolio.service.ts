import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { Repository } from 'typeorm';

import { CreatePortfolioDto, UpdatePortfolioDto } from './dto';
import { Portfolio } from './portfolio.entity';
import User from '../users/users.entity';

@Injectable()
export class PortfolioService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  constructor(@InjectRepository(Portfolio) private readonly portfolio: Repository<Portfolio>) {}

  async getPortfolio(): Promise<Portfolio[]> {
    return await this.portfolio.find({
      relations: ['coin']
    });
  }

  async getPortfolioById(portfolioId: string): Promise<Portfolio> {
    return await this.portfolio.findOne({ where: { id: portfolioId }, relations: ['coin'] });
  }

  async getPortfolioByUser(user: User): Promise<Portfolio[]> {
    return await this.portfolio.find({
      where: {
        user: {
          id: user.id
        }
      },
      relations: ['coin']
    });
  }

  async createPortfolioItem(Portfolio: CreatePortfolioDto, user: User): Promise<Portfolio> {
    //const coin = await this.gecko.coinId({ id: dto.coin, localization: false, developer_data: false });
    const portfolio = await this.portfolio.findOne({
      where: {
        coin: {
          id: Portfolio.coin.id
        },
        user: {
          id: user.id
        }
      }
    });
    return portfolio ?? ((await this.portfolio.insert({ ...Portfolio, user })).generatedMaps[0] as Portfolio);
  }

  async updatePortfolioItem(Portfolio: UpdatePortfolioDto): Promise<Portfolio> {
    return await this.portfolio.save(Portfolio);
  }

  async deletePortfolioItem(portfolioId: string) {
    return await this.portfolio.delete(portfolioId);
  }
}
