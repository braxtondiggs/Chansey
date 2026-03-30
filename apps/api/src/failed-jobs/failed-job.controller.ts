import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Role } from '@chansey/api-interfaces';

import { BulkDismissDto, FailedJobQueryDto, ReviewFailedJobDto } from './dto';
import { FailedJobService } from './failed-job.service';

import { Roles } from '../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';

@ApiTags('Admin - Failed Jobs')
@ApiBearerAuth('token')
@Controller('admin/failed-jobs')
@UseGuards(JwtAuthenticationGuard, RolesGuard)
@Roles(Role.ADMIN)
export class FailedJobController {
  constructor(private readonly failedJobService: FailedJobService) {}

  @Get()
  @ApiOperation({ summary: 'List failed jobs with filters' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Paginated list of failed jobs.' })
  async findAll(@Query() query: FailedJobQueryDto) {
    return this.failedJobService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get aggregate failure statistics' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Failure statistics by severity, queue, and status.' })
  async getStats() {
    return this.failedJobService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get failed job detail' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Full failed job log entry.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.failedJobService.findOne(id);
  }

  @Post(':id/review')
  @ApiOperation({ summary: 'Review or dismiss a failed job' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Job reviewed successfully.' })
  async reviewJob(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewFailedJobDto, @Req() req: any) {
    return this.failedJobService.reviewJob(id, dto, req.user.id);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Re-enqueue a failed job to its original queue' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Job re-enqueued successfully.' })
  async retryJob(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.failedJobService.retryJob(id, req.user.id);
  }

  @Post('bulk-dismiss')
  @ApiOperation({ summary: 'Dismiss multiple failed jobs' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Jobs dismissed successfully.' })
  async bulkDismiss(@Body() dto: BulkDismissDto, @Req() req: any) {
    const affected = await this.failedJobService.bulkDismiss(dto.ids, req.user.id);
    return { dismissed: affected };
  }
}
