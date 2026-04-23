import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';

import { IsOptional, IsUUID } from 'class-validator';
import { Repository } from 'typeorm';

import { Role } from '@chansey/api-interfaces';

import { ListingAnnouncementQueryDto } from './dto/listing-announcement.dto';
import { ListingCandidateQueryDto } from './dto/listing-candidate.dto';
import { ListingTradePositionQueryDto } from './dto/listing-trade-position.dto';
import { ListingAnnouncement } from './entities/listing-announcement.entity';
import { ListingCandidate } from './entities/listing-candidate.entity';
import { ListingTradePosition } from './entities/listing-trade-position.entity';
import { ListingTrackerService } from './services/listing-tracker.service';
import { ListingScoreTask } from './tasks/listing-score.task';

import { Roles } from '../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';
import { Coin } from '../coin/coin.entity';

const MAX_LIMIT = 500;

class RetryAnnouncementDto {
  @IsOptional()
  @IsUUID()
  coinId?: string;
}

@ApiTags('Admin - Listing Tracker')
@ApiBearerAuth('token')
@Controller('admin/listing-tracker')
@UseGuards(JwtAuthenticationGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ListingTrackerController {
  constructor(
    @InjectRepository(ListingAnnouncement)
    private readonly announcementRepo: Repository<ListingAnnouncement>,
    @InjectRepository(ListingCandidate)
    private readonly candidateRepo: Repository<ListingCandidate>,
    @InjectRepository(ListingTradePosition)
    private readonly positionRepo: Repository<ListingTradePosition>,
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>,
    private readonly tracker: ListingTrackerService,
    private readonly scoreTask: ListingScoreTask
  ) {}

  @Get('announcements')
  @ApiOperation({ summary: 'List recent listing announcements' })
  async listAnnouncements(@Query() query: ListingAnnouncementQueryDto) {
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit ?? 100)));
    const qb = this.announcementRepo.createQueryBuilder('ann').orderBy('ann.detectedAt', 'DESC').take(limit);

    if (query.since) {
      qb.andWhere('ann.detectedAt >= :since', { since: new Date(query.since) });
    }
    if (query.exchangeSlug) {
      qb.andWhere('ann.exchangeSlug = :slug', { slug: query.exchangeSlug });
    }

    return qb.getMany();
  }

  @Get('candidates')
  @ApiOperation({ summary: 'List cross-listing candidates' })
  async listCandidates(@Query() query: ListingCandidateQueryDto) {
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit ?? 100)));
    const where = query.qualified === undefined ? {} : { qualified: query.qualified };
    return this.candidateRepo.find({ where, order: { score: 'DESC' }, take: limit });
  }

  @Get('positions')
  @ApiOperation({ summary: 'List listing trade positions' })
  async listPositions(@Query() query: ListingTradePositionQueryDto) {
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit ?? 100)));
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.strategyType) where.strategyType = query.strategyType;
    return this.positionRepo.find({ where, order: { createdAt: 'DESC' }, take: limit });
  }

  @Post('candidates/rescore')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger an immediate scoring run' })
  async rescore() {
    await this.scoreTask.runNow();
    return { status: 'queued' };
  }

  @Post('announcements/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Re-fan-out an announcement to eligible users. Optionally override the coin mapping via `coinId` query or body param when the original row was detected without a match.'
  })
  async retryAnnouncement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('coinId', new ParseUUIDPipe({ optional: true })) coinIdQuery?: string,
    @Body() body?: RetryAnnouncementDto
  ) {
    const announcement = await this.announcementRepo.findOne({ where: { id } });
    if (!announcement) throw new NotFoundException(`Announcement ${id} not found`);

    const overrideCoinId = coinIdQuery ?? body?.coinId;
    if (overrideCoinId && !announcement.coinId) {
      const overrideCoin = await this.coinRepo.findOne({ where: { id: overrideCoinId } });
      if (!overrideCoin) throw new BadRequestException(`Coin ${overrideCoinId} not found`);
      announcement.coinId = overrideCoin.id;
      announcement.coin = overrideCoin;
      await this.announcementRepo.save(announcement);
    }

    if (!announcement.coinId) {
      return { status: 'skipped', reason: 'no-coin-mapping' };
    }
    const coin = await this.coinRepo.findOne({ where: { id: announcement.coinId } });
    if (!coin) return { status: 'skipped', reason: 'coin-missing' };

    await this.tracker.handleNewAnnouncement(announcement, coin);
    return { status: 'queued' };
  }
}
