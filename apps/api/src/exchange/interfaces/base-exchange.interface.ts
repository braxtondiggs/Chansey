import * as ccxt from 'ccxt';

import type { AssetBalanceDto } from '../../balance/dto/balance-response.dto';
import type { User } from '../../users/users.entity';

/**
 * DI token for IBaseExchangeService implementations
 */
export const BASE_EXCHANGE_SERVICE = Symbol('BASE_EXCHANGE_SERVICE');

/**
 * Interface for BaseExchangeService implementations
 * Used to break circular dependencies between exchange-related services
 */
export interface IBaseExchangeService {
  getClient(user?: User): Promise<ccxt.Exchange>;
  getDefaultClient(): Promise<ccxt.Exchange>;
  getPublicClient(): Promise<ccxt.Exchange>;
  getTemporaryClient(apiKey: string, apiSecret: string): Promise<ccxt.Exchange>;
  getBalance(user: User): Promise<AssetBalanceDto[]>;
  getFreeBalance(user: User): Promise<AssetBalanceDto[]>;
  getPriceBySymbol(symbol: string, user?: User): Promise<number>;
  getPrice(symbol: string, user?: User): Promise<{ symbol: string; price: string; timestamp: number }>;
  validateKeys(apiKey: string, apiSecret: string): Promise<void>;
  formatSymbol(symbol: string): string;
}
