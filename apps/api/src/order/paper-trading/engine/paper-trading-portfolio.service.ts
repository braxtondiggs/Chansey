import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { getQuoteCurrency as getQuoteCurrencyUtil } from '../../../exchange/constants';
import { Portfolio } from '../../backtest/shared';
import { PaperTradingAccount } from '../entities';

/**
 * Encapsulates portfolio construction, repricing, and valuation for the paper-trading engine.
 * Collapses the repeated "load accounts → build portfolio → reprice" sequence used throughout
 * the engine tick loop.
 */
@Injectable()
export class PaperTradingPortfolioService {
  constructor(
    @InjectRepository(PaperTradingAccount)
    private readonly accountRepository: Repository<PaperTradingAccount>
  ) {}

  /** Fetch raw account rows for a session. */
  loadAccounts(sessionId: string): Promise<PaperTradingAccount[]> {
    return this.accountRepository.find({ where: { session: { id: sessionId } } });
  }

  /** Derive the quote currency from a set of accounts. */
  getQuoteCurrency(accounts: PaperTradingAccount[]): string {
    return getQuoteCurrencyUtil(accounts.map((a) => a.currency));
  }

  /** Build an unpriced Portfolio from accounts. Position values are set to 0 until repriced. */
  buildFromAccounts(accounts: PaperTradingAccount[], quoteCurrency: string): Portfolio {
    const quoteAccount = accounts.find((a) => a.currency === quoteCurrency);

    const positions = new Map<string, { coinId: string; quantity: number; averagePrice: number; totalValue: number }>();

    for (const account of accounts) {
      if (account.currency !== quoteCurrency && account.total > 0) {
        positions.set(account.currency, {
          coinId: account.currency,
          quantity: account.total,
          averagePrice: account.averageCost ?? 0,
          totalValue: 0
        });
      }
    }

    return {
      cashBalance: quoteAccount?.available ?? 0,
      positions,
      totalValue: quoteAccount?.available ?? 0
    };
  }

  /** Mutates a portfolio's position totalValue + totalValue based on current prices. */
  updateWithPrices(portfolio: Portfolio, prices: Record<string, number>, quoteCurrency: string): Portfolio {
    let positionsValue = 0;

    for (const [coinId, position] of portfolio.positions) {
      const symbol = `${coinId}/${quoteCurrency}`;
      const price = prices[symbol] ?? 0;
      position.totalValue = position.quantity * price;
      positionsValue += position.totalValue;
    }

    portfolio.totalValue = portfolio.cashBalance + positionsValue;
    return portfolio;
  }

  /** Calculate total portfolio value without mutating the portfolio. */
  calculateValue(portfolio: Portfolio, prices: Record<string, number>, quoteCurrency: string): number {
    let total = portfolio.cashBalance;

    for (const [, position] of portfolio.positions) {
      const symbol = `${position.coinId}/${quoteCurrency}`;
      const price = prices[symbol] ?? 0;
      total += position.quantity * price;
    }

    return total;
  }

  /** Build a plain-object positions context for algorithm consumption. */
  buildPositionsContext(accounts: PaperTradingAccount[], quoteCurrency: string): Record<string, number> {
    const positions: Record<string, number> = {};
    for (const account of accounts) {
      if (account.currency !== quoteCurrency && account.total > 0) {
        positions[account.currency] = account.total;
      }
    }
    return positions;
  }

  /**
   * Refresh portfolio from the database: load accounts for the session, build portfolio,
   * reprice with the supplied price map. Collapses the duplicated pattern in the engine.
   */
  async refresh(
    sessionId: string,
    priceMap: Record<string, number>,
    quoteCurrency: string
  ): Promise<{ accounts: PaperTradingAccount[]; portfolio: Portfolio }> {
    const accounts = await this.accountRepository.find({ where: { session: { id: sessionId } } });
    const portfolio = this.updateWithPrices(this.buildFromAccounts(accounts, quoteCurrency), priceMap, quoteCurrency);
    return { accounts, portfolio };
  }
}
