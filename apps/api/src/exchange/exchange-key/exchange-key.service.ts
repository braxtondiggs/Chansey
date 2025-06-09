import { InjectQueue } from '@nestjs/bullmq';
import { forwardRef, Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { CreateExchangeKeyDto } from './dto';
import { ExchangeKey } from './exchange-key.entity';

import { ExchangeManagerService } from '../exchange-manager.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class ExchangeKeyService {
  constructor(
    @InjectRepository(ExchangeKey)
    private exchangeKeyRepository: Repository<ExchangeKey>,
    @Inject(forwardRef(() => ExchangeService))
    private exchangeService: ExchangeService,
    @Inject(forwardRef(() => ExchangeManagerService))
    private exchangeManagerService: ExchangeManagerService,
    @InjectQueue('order-queue') private readonly orderQueue: Queue
  ) {}

  async findAll(userId: string): Promise<ExchangeKey[]> {
    return this.exchangeKeyRepository.find({
      where: { userId },
      relations: ['exchange']
    });
  }

  /**
   * Checks if a user has any active keys for supported exchanges and returns exchange details
   * @param userId - The ID of the user to check
   * @returns An object containing a boolean flag and the list of supported exchanges with active keys
   */
  async hasSupportedExchangeKeys(userId: string, top_level = false): Promise<ExchangeKey[]> {
    const keys = await this.exchangeKeyRepository.find({
      where: {
        userId
      },
      relations: ['exchange']
    });

    const supportedExchangeKeys = keys.filter((key) => key.exchange?.supported === true);

    // Create a map to deduplicate exchanges (user might have multiple keys for same exchange)
    const exchangeMap = new Map<string, any>();

    supportedExchangeKeys.forEach((key) => {
      if (key.exchange) {
        interface ExchangeKeyData {
          id: string;
          exchangeId: string;
          isActive: boolean;
          name: string;
          slug: string;
          decryptedApiKey?: string;
          decryptedSecretKey?: string;
        }

        const keyData: ExchangeKeyData = {
          id: key.id,
          exchangeId: key.exchange.id,
          isActive: key.isActive,
          name: key.exchange.name,
          slug: key.exchange.slug
        };

        // Include decrypted API keys when top_level is true
        // This will make them available for internal services without exposing them externally
        if (top_level) {
          keyData.decryptedApiKey = key.decryptedApiKey;
          keyData.decryptedSecretKey = key.decryptedSecretKey;
        }

        exchangeMap.set(key.exchange.id, keyData);
      }
    });

    const exchanges = Array.from(exchangeMap.values());

    return exchanges;
  }

  async findOne(id: string, userId: string): Promise<ExchangeKey> {
    const key = await this.exchangeKeyRepository.findOne({
      where: { id, userId },
      relations: ['exchange']
    });

    if (!key) {
      throw new NotFoundException(`Exchange key with ID ${id} not found`);
    }

    return key;
  }

  /**
   * Finds a single exchange key by exchange ID and user ID
   * @param exchangeId - The ID of the exchange
   * @param userId - The ID of the user
   * @returns The exchange key or null if not found
   */
  async findOneByExchangeId(exchangeId: string, userId: string): Promise<ExchangeKey | null> {
    return this.exchangeKeyRepository.findOne({
      where: { exchangeId, userId },
      relations: ['exchange']
    });
  }

  async findByExchange(exchangeId: string, userId: string): Promise<ExchangeKey[]> {
    // This method is kept for backward compatibility but now will return at most one key
    const key = await this.findOneByExchangeId(exchangeId, userId);
    return key ? [key] : [];
  }

  async create(userId: string, createExchangeKeyDto: CreateExchangeKeyDto): Promise<ExchangeKey> {
    // Check if the exchange exists
    const exchange = await this.exchangeService.findOne(createExchangeKeyDto.exchangeId);

    // Check if the user already has a key for this exchange
    const existingKey = await this.findOneByExchangeId(createExchangeKeyDto.exchangeId, userId);

    // If a key already exists, throw a ConflictException
    if (existingKey) {
      throw new ConflictException(
        `You already have API keys for ${exchange.name}. Please remove the existing keys before adding new ones.`
      );
    }

    // Create the exchange key entity but don't save it yet
    const exchangeKey = this.exchangeKeyRepository.create({
      ...createExchangeKeyDto,
      userId
    });

    // Validate the API keys based on exchange type
    const isValid = await this.validateExchangeKeys(
      exchange.slug,
      createExchangeKeyDto.apiKey,
      createExchangeKeyDto.secretKey,
      userId
    );

    // Set isActive based on validation result
    exchangeKey.isActive = isValid;

    // Save the exchange key
    return this.exchangeKeyRepository.save(exchangeKey);
  }

  async remove(id: string, userId: string): Promise<ExchangeKey> {
    const exchangeKey = await this.findOne(id, userId);
    return await this.exchangeKeyRepository.remove(exchangeKey);
  }

  /**
   * Validates that the provided API keys work with the specified exchange
   * @param exchangeSlug - The slug of the exchange (e.g., 'binance_us', 'coinbase')
   * @param apiKey - The API key to validate
   * @param secretKey - The secret key to validate
   * @param userId - The ID of the user who owns the key (optional)
   * @returns true if validation is successful, false otherwise
   */
  async validateExchangeKeys(
    exchangeSlug: string,
    apiKey: string,
    secretKey: string,
    userId?: string
  ): Promise<boolean> {
    try {
      // Get the exchange service through the manager
      const exchangeService = this.exchangeManagerService.getExchangeService(exchangeSlug);

      // Use the base exchange service's validateKeys method
      await exchangeService.validateKeys(apiKey, secretKey);

      // If we get here, validation was successful
      const isValid = true;

      // If validation is successful and userId is provided, add a job to sync orders
      if (isValid && userId) {
        await this.orderQueue.add(
          'sync-orders',
          {
            userId,
            timestamp: new Date().toISOString(),
            description: `Sync orders for user ${userId} after successful exchange key validation`
          },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000
            },
            removeOnComplete: 100,
            removeOnFail: 50
          }
        );
      }

      return isValid;
    } catch (error) {
      // Validation failed, return false instead of throwing an exception
      // The caller will handle setting isActive to false
      return false;
    }
  }
}
