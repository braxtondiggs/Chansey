import type { Exchange } from '../exchange.entity';

/**
 * Interface for ExchangeService
 * Used to break circular dependencies between exchange-related services
 */
export interface IExchangeService {
  findOne(id: string): Promise<Exchange>;
  findBySlug(slug: string): Promise<Exchange>;
  getExchanges(options?: { supported?: boolean }): Promise<Exchange[]>;
  getExchangeById(exchangeId: string): Promise<Exchange>;
  getExchangeByName(name: string): Promise<Exchange>;
  findAllWithUserKeys(userId: string): Promise<Exchange[]>;
}

/**
 * DI token for IExchangeService
 */
export const EXCHANGE_SERVICE = Symbol('EXCHANGE_SERVICE');
