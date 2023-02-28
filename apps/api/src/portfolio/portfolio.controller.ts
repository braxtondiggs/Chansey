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
  @UseGuards(JwtAuthenticationGuard)
  async getPortfolio(@Req() { user }: RequestWithUser) {
    return this.portfolio.getPortfolio(user);
  }

  @Get(':id')
  @UseGuards(JwtAuthenticationGuard)
  getPortfolioById(@Param() { id }: FindOneParams, @Req() { user }: RequestWithUser) {
    return this.portfolio.getPortfolioById(id, user);
  }

  @Post()
  @UseGuards(JwtAuthenticationGuard)
  async createPortfolioItem(@Body() dto: CreatePortfolioDto, @Req() { user }: RequestWithUser) {
    return this.portfolio.createPortfolioItem(dto, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthenticationGuard)
  async updatePortfolioItem(
    @Param() { id }: FindOneParams,
    @Body() dto: CreatePortfolioDto,
    @Req() { user }: RequestWithUser
  ) {
    return this.portfolio.updatePortfolioItem(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthenticationGuard)
  async deletePortfolioItem(@Param() { id }: FindOneParams, @Req() { user }: RequestWithUser) {
    return this.portfolio.deletePortfolioItem(id, user);
  }
}
