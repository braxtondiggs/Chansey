import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { ILike, Repository } from 'typeorm';

import { Algorithm, AlgorithmStatus } from './algorithm.entity';
import { CreateAlgorithmDto, UpdateAlgorithmDto } from './dto/';

import { NotFoundCustomException } from '../utils/filters/not-found.exception';

@Injectable()
export class AlgorithmService {
  constructor(@InjectRepository(Algorithm) private readonly algorithm: Repository<Algorithm>) {}

  async getAlgorithms(): Promise<Algorithm[]> {
    const algorithms = await this.algorithm.find();
    return algorithms.map((algorithm) => {
      Object.keys(algorithm).forEach((key) => algorithm[key] === null && delete algorithm[key]);
      return algorithm;
    });
  }

  async getActiveAlgorithms(): Promise<Algorithm[]> {
    const algorithms = await this.algorithm.find({ where: { status: AlgorithmStatus.ACTIVE } });
    return algorithms.map((algorithm) => {
      Object.keys(algorithm).forEach((key) => algorithm[key] === null && delete algorithm[key]);
      return algorithm;
    });
  }

  async getAlgorithmsForTesting(): Promise<Algorithm[]> {
    const algorithms = await this.algorithm.find({ 
      where: { 
        evaluate: true, 
        status: AlgorithmStatus.ACTIVE 
      } 
    });
    return algorithms.map((algorithm) => {
      Object.keys(algorithm).forEach((key) => algorithm[key] === null && delete algorithm[key]);
      return algorithm;
    });
  }

  async getAlgorithmById(algorithmId: string): Promise<Algorithm> {
    const algorithm = await this.algorithm.findOneBy({ id: algorithmId });
    if (!algorithm) throw new NotFoundCustomException('Algorithm', { id: algorithmId });
    Object.keys(algorithm).forEach((key) => algorithm[key] === null && delete algorithm[key]);
    return algorithm;
  }

  async create(Algorithm: CreateAlgorithmDto): Promise<Algorithm> {
    const algorithm = await this.algorithm.findOne({ where: { name: ILike(`%${Algorithm.name}%`) } });
    return algorithm ?? ((await this.algorithm.insert(Algorithm)).generatedMaps[0] as Algorithm);
  }

  async update(algorithmId: string, algorithm: UpdateAlgorithmDto) {
    const data = await this.getAlgorithmById(algorithmId);
    if (!data) throw new NotFoundCustomException('Algorithm', { id: algorithmId });
    return await this.algorithm.save(new Algorithm({ ...data, ...algorithm }));
  }

  async remove(algorithmId: string) {
    const response = await this.algorithm.delete(algorithmId);
    if (!response.affected) throw new NotFoundCustomException('Algorithm', { id: algorithmId });
    return response;
  }
}
