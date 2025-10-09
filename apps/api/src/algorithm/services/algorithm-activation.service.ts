import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { AlgorithmActivation } from '../algorithm-activation.entity';
import { AlgorithmConfig } from '../algorithm.entity';

/**
 * AlgorithmActivationService
 *
 * Manages user-specific algorithm activations and deactivations.
 * Validates exchange keys and handles activation state transitions.
 */
@Injectable()
export class AlgorithmActivationService {
  constructor(
    @InjectRepository(AlgorithmActivation)
    private readonly algorithmActivationRepository: Repository<AlgorithmActivation>,
    private readonly exchangeKeyService: ExchangeKeyService
  ) {}

  /**
   * Activate an algorithm for a user with a specific exchange key
   * @param userId - User ID who is activating the algorithm
   * @param algorithmId - Algorithm ID to activate
   * @param exchangeKeyId - Exchange key ID to use for trading
   * @param config - Optional user-specific configuration overrides
   * @returns The created or updated AlgorithmActivation
   * @throws BadRequestException if already activated or exchange key not found
   */
  async activate(
    userId: string,
    algorithmId: string,
    exchangeKeyId: string,
    config?: AlgorithmConfig
  ): Promise<AlgorithmActivation> {
    // Validate that exchange key exists and belongs to the user
    const exchangeKey = await this.exchangeKeyService.findOne(exchangeKeyId, userId);
    if (!exchangeKey) {
      throw new NotFoundException('Exchange key not found');
    }

    // Check if activation already exists
    const existingActivation = await this.algorithmActivationRepository.findOne({
      where: { userId, algorithmId },
      relations: ['algorithm', 'exchangeKey']
    });

    if (existingActivation && existingActivation.isActive) {
      throw new BadRequestException('Algorithm is already activated');
    }

    // If activation exists but was deactivated, reactivate it
    if (existingActivation) {
      existingActivation.exchangeKeyId = exchangeKeyId;
      existingActivation.config = config || existingActivation.config;
      existingActivation.activate();
      return await this.algorithmActivationRepository.save(existingActivation);
    }

    // Create new activation
    const activation = new AlgorithmActivation({
      userId,
      algorithmId,
      exchangeKeyId,
      isActive: true,
      allocationPercentage: 1.0, // Default 1% allocation
      config,
      activatedAt: new Date(),
      deactivatedAt: null
    });

    return await this.algorithmActivationRepository.save(activation);
  }

  /**
   * Deactivate an algorithm for a user
   * @param userId - User ID who is deactivating the algorithm
   * @param algorithmId - Algorithm ID to deactivate
   * @returns The updated AlgorithmActivation
   * @throws NotFoundException if activation not found
   * @throws BadRequestException if already deactivated
   */
  async deactivate(userId: string, algorithmId: string): Promise<AlgorithmActivation> {
    const activation = await this.algorithmActivationRepository.findOne({
      where: { userId, algorithmId },
      relations: ['algorithm', 'exchangeKey']
    });

    if (!activation) {
      throw new NotFoundException('Algorithm activation not found');
    }

    if (!activation.isActive) {
      throw new BadRequestException('Algorithm is already deactivated');
    }

    activation.deactivate();
    return await this.algorithmActivationRepository.save(activation);
  }

  /**
   * Find all active algorithm activations for a user
   * @param userId - User ID
   * @returns Array of active AlgorithmActivations with relations
   */
  async findUserActiveAlgorithms(userId: string): Promise<AlgorithmActivation[]> {
    return await this.algorithmActivationRepository.find({
      where: { userId, isActive: true },
      relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange'],
      order: { activatedAt: 'DESC' }
    });
  }

  /**
   * Find all algorithm activations for a user (active and inactive)
   * @param userId - User ID
   * @returns Array of all AlgorithmActivations
   */
  async findUserAlgorithms(userId: string): Promise<AlgorithmActivation[]> {
    return await this.algorithmActivationRepository.find({
      where: { userId },
      relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange'],
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Find a specific algorithm activation by ID
   * @param activationId - AlgorithmActivation ID
   * @param userId - User ID (for ownership validation)
   * @returns AlgorithmActivation with relations
   * @throws NotFoundException if not found or user doesn't own it
   */
  async findById(activationId: string, userId?: string): Promise<AlgorithmActivation> {
    const where = userId ? { id: activationId, userId } : { id: activationId };

    const activation = await this.algorithmActivationRepository.findOne({
      where,
      relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange']
    });

    if (!activation) {
      throw new NotFoundException('Algorithm activation not found');
    }

    return activation;
  }

  /**
   * Find all active algorithm activations (across all users) for background jobs
   * @returns Array of active AlgorithmActivations
   */
  async findAllActiveAlgorithms(): Promise<AlgorithmActivation[]> {
    return await this.algorithmActivationRepository.find({
      where: { isActive: true },
      relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange', 'user']
    });
  }

  /**
   * Update allocation percentage for an algorithm activation based on performance ranking
   * @param activationId - AlgorithmActivation ID
   * @param percentage - New allocation percentage (0.01-100.00)
   * @throws NotFoundException if activation not found
   * @throws BadRequestException if percentage out of range
   */
  async updateAllocationPercentage(activationId: string, percentage: number): Promise<void> {
    const activation = await this.algorithmActivationRepository.findOneBy({ id: activationId });

    if (!activation) {
      throw new NotFoundException('Algorithm activation not found');
    }

    if (percentage < 0.01 || percentage > 100.0) {
      throw new BadRequestException('Allocation percentage must be between 0.01 and 100.00');
    }

    activation.updateAllocation(percentage);
    await this.algorithmActivationRepository.save(activation);
  }

  /**
   * Update custom configuration for an algorithm activation
   * @param userId - User ID
   * @param algorithmId - Algorithm ID
   * @param config - Updated configuration
   * @returns Updated AlgorithmActivation
   */
  async updateConfig(userId: string, algorithmId: string, config: AlgorithmConfig): Promise<AlgorithmActivation> {
    const activation = await this.algorithmActivationRepository.findOne({
      where: { userId, algorithmId }
    });

    if (!activation) {
      throw new NotFoundException('Algorithm activation not found');
    }

    activation.config = config;
    return await this.algorithmActivationRepository.save(activation);
  }
}
