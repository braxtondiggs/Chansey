import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Risk } from '@chansey/api-interfaces';

import { CreateRiskDto, UpdateRiskDto } from './dto';
import { Risk as RiskEntity } from './risk.entity';
import { RiskService } from './risk.service';

import { Roles } from '../authentication/decorator/roles.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';

@ApiTags('Risk')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
@Controller('risk')
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Post()
  @UseGuards(JwtAuthenticationGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Create a new risk profile' })
  @ApiResponse({ status: 201, description: 'The risk has been successfully created.', type: RiskEntity })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Access denied. Admin role required.' })
  create(@Body() createRiskDto: CreateRiskDto): Promise<Risk> {
    return this.riskService.create(createRiskDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all risk profiles' })
  @ApiResponse({ status: 200, description: 'Return all risks.', type: [RiskEntity] })
  findAll(): Promise<Risk[]> {
    return this.riskService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a risk profile by id' })
  @ApiParam({ name: 'id', description: 'Risk ID' })
  @ApiResponse({ status: 200, description: 'Return the risk.', type: RiskEntity })
  @ApiResponse({ status: 404, description: 'Risk not found.' })
  findOne(@Param('id') id: string): Promise<Risk> {
    return this.riskService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthenticationGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Update a risk profile' })
  @ApiParam({ name: 'id', description: 'Risk ID' })
  @ApiResponse({ status: 200, description: 'The risk has been successfully updated.', type: RiskEntity })
  @ApiResponse({ status: 404, description: 'Risk not found.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Access denied. Admin role required.' })
  update(@Param('id') id: string, @Body() updateRiskDto: UpdateRiskDto): Promise<Risk> {
    return this.riskService.update(id, updateRiskDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthenticationGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Delete a risk profile' })
  @ApiParam({ name: 'id', description: 'Risk ID' })
  @ApiResponse({ status: 200, description: 'The risk has been successfully deleted.' })
  @ApiResponse({ status: 404, description: 'Risk not found.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Access denied. Admin role required.' })
  remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.riskService.remove(id);
  }
}
