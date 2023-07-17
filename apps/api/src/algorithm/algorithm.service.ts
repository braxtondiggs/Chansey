import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { Algorithm } from './algorithm.entity';
import { CreateAlgorithmDto, UpdateAlgorithmDto } from './dto/';

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

  async getAlgorithmById(algorithmId: string): Promise<Algorithm> {
    const algorithm = await this.algorithm.findOneBy({ id: algorithmId });
    Object.keys(algorithm).forEach((key) => algorithm[key] === null && delete algorithm[key]);
    return algorithm;
  }

  async create(Algorithm: CreateAlgorithmDto): Promise<Algorithm> {
    const algorithm = await this.algorithm.findOne({ where: { name: ILike(`%${Algorithm.name}%`) } });
    return algorithm ?? ((await this.algorithm.insert(Algorithm)).generatedMaps[0] as Algorithm);
  }

  async update(algorithmId: string, algorithm: UpdateAlgorithmDto) {
    const data = await this.getAlgorithmById(algorithmId);
    return await this.algorithm.save(new Algorithm({ ...data, ...algorithm }));
  }

  async remove(algorithmId: string) {
    return await this.algorithm.delete(algorithmId);
  }
}
