import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreatePortfolioDto, UpdatePortfolioDto } from './dto';
import { Portfolio } from './portfolio.entity';
import User from '../users/users.entity';

@Injectable()
export class PortfolioService {
  constructor(@InjectRepository(Portfolio) private readonly portfolio: Repository<Portfolio>) {}

  async getPortfolio(): Promise<Portfolio[]> {
    return await this.portfolio.find({
      relations: ['coin']
    });
  }

  async getPortfolioById(portfolioId: string, userId: string): Promise<Portfolio> {
    return await this.portfolio.findOne({ where: { id: portfolioId, user: { id: userId } }, relations: ['coin'] });
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
    const portfolio = await this.portfolio.findOne({
      // NOTE: For some stupid ass reason if the coin id is incorrect (Must be UUID) then typeorm will just omit the where statement for the coin. Resulting in just the users profile to return. Need ta fix for this would be very confusing down the road. Can lookup coin to see if valid first but this omits the whole purpose
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

  async updatePortfolioItem(portfolioId: string, userId: string, dto: UpdatePortfolioDto): Promise<Portfolio> {
    const data = await this.getPortfolioById(portfolioId, userId);
    return await this.portfolio.save(new Portfolio({ ...data, ...dto }));
  }

  async deletePortfolioItem(portfolioId: string, userId: string) {
    return await this.portfolio.delete({
      id: portfolioId,
      user: {
        id: userId
      }
    });
  }
}
