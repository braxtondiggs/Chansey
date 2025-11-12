import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, Not } from 'typeorm';

import { CreateRiskDto, UpdateRiskDto } from './dto';
import { Risk } from './risk.entity';

@Injectable()
export class RiskService {
  constructor(
    @InjectRepository(Risk)
    private readonly riskRepository: Repository<Risk>
  ) {}

  async findAll(): Promise<Risk[]> {
    return this.riskRepository.find({
      where: { level: Not(6) }, // TODO: Exclude level 6 from the results
      order: { level: 'ASC' }
    });
  }

  async findOne(id: string): Promise<Risk> {
    const risk = await this.riskRepository.findOne({
      where: { id }
    });
    if (!risk) {
      throw new NotFoundException(`Risk with ID "${id}" not found`);
    }
    return risk;
  }

  async create(createRiskDto: CreateRiskDto): Promise<Risk> {
    const risk = this.riskRepository.create(createRiskDto);
    return this.riskRepository.save(risk);
  }

  async update(id: string, updateRiskDto: UpdateRiskDto): Promise<Risk> {
    const risk = await this.findOne(id);

    // Update the risk entity with the new values
    Object.assign(risk, updateRiskDto);

    return this.riskRepository.save(risk);
  }

  async remove(id: string) {
    const result = await this.riskRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Risk with ID "${id}" not found`);
    }
    return { message: `Risk with ID "${id}" deleted successfully` };
  }
}
