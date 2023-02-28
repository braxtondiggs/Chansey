import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';

import { CreatePortfolioDto } from './dto';
import { PortfolioService } from './portfolio.service';
import JwtAuthenticationGuard from '../authentication/jwt-authentication.guard';
import RequestWithUser from '../authentication/requestWithUser.interface';
import FindOneParams from '../utils/findOneParams';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  async getPortfolio() {
    return this.portfolio.getPortfolio();
  }

  @Get(':id')
  getPortfolioById(@Param() { id }: FindOneParams) {
    return this.portfolio.getPortfolioById(id);
  }

  @Post()
  @UseGuards(JwtAuthenticationGuard)
  async createPortfolioItem(@Body() dto: CreatePortfolioDto, @Req() { user }: RequestWithUser) {
    return this.portfolio.createPortfolioItem(dto, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthenticationGuard)
  async updatePortfolioItem(@Param() { id }: FindOneParams, @Body() dto: CreatePortfolioDto) {
    return this.portfolio.updatePortfolioItem(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthenticationGuard)
  async deletePortfolioItem(@Param() { id }: FindOneParams) {
    return this.portfolio.deletePortfolioItem(id);
  }
}
