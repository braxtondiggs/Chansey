import {
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ConflictException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { CreateExchangeKeyDto, UpdateExchangeKeyDto } from './dto';
import { ExchangeKey } from './exchange-key.entity';

import { BinanceService } from '../binance/binance.service';
import { CoinbaseService } from '../coinbase/coinbase.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class ExchangeKeyService {
  constructor(
    @InjectRepository(ExchangeKey)
    private exchangeKeyRepository: Repository<ExchangeKey>,
    @Inject(forwardRef(() => ExchangeService))
    private exchangeService: ExchangeService,
    @Inject(forwardRef(() => BinanceService))
    private binanceService: BinanceService,
    @Inject(forwardRef(() => CoinbaseService))
    private coinbaseService: CoinbaseService
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
  async hasSupportedExchangeKeys(userId: string): Promise<ExchangeKey[]> {
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
        exchangeMap.set(key.exchange.id, {
          id: key.id,
          exchangeId: key.exchange.id,
          isActive: key.isActive,
          name: key.exchange.name,
          slug: key.exchange.slug
        });
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
      createExchangeKeyDto.secretKey
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
   * @param exchangeSlug - The slug of the exchange (e.g., 'binance', 'coinbase')
   * @param apiKey - The API key to validate
   * @param secretKey - The secret key to validate
   * @throws UnauthorizedException if the keys are invalid
   * @throws BadRequestException if the exchange is not supported for validation
   * @returns true if validation is successful, false otherwise
   */
  async validateExchangeKeys(exchangeSlug: string, apiKey: string, secretKey: string): Promise<boolean> {
    try {
      switch (exchangeSlug.toLowerCase()) {
        case 'binance_us':
          await this.validateBinanceKeys(apiKey, secretKey);
          break;
        case 'gdax': //coinbase slug
          await this.validateCoinbaseKeys(apiKey, secretKey);
          break;
        default:
          // For unsupported exchanges, we'll allow the keys without validation
          return true;
      }
      // If we get here, validation was successful
      return true;
    } catch (error) {
      // Validation failed, return false instead of throwing an exception
      // The caller will handle setting isActive to false
      return false;
    }
  }

  /**
   * Validates Binance API keys by attempting to get account information
   */
  private async validateBinanceKeys(apiKey: string, secretKey: string): Promise<void> {
    try {
      // Create a temporary client with the provided keys
      const binanceClient = await this.binanceService.getTemporaryClient(apiKey, secretKey);

      // Try to fetch account info - this will throw an error if the keys are invalid
      await binanceClient.accountInfo();
    } catch (error) {
      throw new UnauthorizedException('Invalid Binance API keys');
    }
  }

  /**
   * Validates Coinbase API keys by attempting to get accounts
   */
  private async validateCoinbaseKeys(apiKey: string, secretKey: string): Promise<void> {
    try {
      // Use the CoinbaseService to validate the keys
      await this.coinbaseService.validateKeys(apiKey, secretKey);
    } catch (error) {
      throw new UnauthorizedException('Invalid Coinbase API keys');
    }
  }
}
