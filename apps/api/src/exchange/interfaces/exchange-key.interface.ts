import type { SupportedExchangeKeyDto } from '../exchange-key/dto';
import type { ExchangeKey } from '../exchange-key/exchange-key.entity';

/**
 * Interface for ExchangeKeyService
 * Used to break circular dependencies between exchange-related services
 */
export interface IExchangeKeyService {
  findAll(userId: string): Promise<ExchangeKey[]>;
  findOneByExchangeId(exchangeId: string, userId: string): Promise<ExchangeKey | null>;
  findByExchange(exchangeId: string, userId: string): Promise<ExchangeKey[]>;
  getSupportedExchangeKeys(userId: string, includeSecrets?: boolean): Promise<SupportedExchangeKeyDto[]>;
}

/**
 * DI token for IExchangeKeyService
 */
export const EXCHANGE_KEY_SERVICE = Symbol('EXCHANGE_KEY_SERVICE');
