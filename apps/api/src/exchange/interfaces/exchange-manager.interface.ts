import * as ccxt from 'ccxt';

import type { IBaseExchangeService } from './base-exchange.interface';

import type { AssetBalanceDto } from '../../balance/dto/balance-response.dto';
import type { User } from '../../users/users.entity';

/**
 * Interface for ExchangeManagerService
 * Used to break circular dependencies between exchange-related services
 */
export interface IExchangeManagerService {
  getExchangeService(exchangeSlug: string): IBaseExchangeService;
  getExchangeClient(exchangeSlug: string, user?: User): Promise<ccxt.Exchange>;
  getPublicClient(exchangeSlug?: string): Promise<ccxt.Exchange>;
  getPrice(
    exchangeSlug: string,
    symbol: string,
    user?: User
  ): Promise<{ symbol: string; price: string; timestamp: number }>;
  getBalance(exchangeSlug: string, user: User): Promise<AssetBalanceDto[]>;
  getQuoteAsset(exchangeSlug: string): string;
  formatSymbol(exchangeSlug: string, symbol: string): string;
  getBalancesFromAllExchanges(user: User): Promise<
    Array<{
      exchange: string;
      success: boolean;
      data?: AssetBalanceDto[];
      error?: string;
    }>
  >;
}

/**
 * DI token for IExchangeManagerService
 */
export const EXCHANGE_MANAGER_SERVICE = Symbol('EXCHANGE_MANAGER_SERVICE');
