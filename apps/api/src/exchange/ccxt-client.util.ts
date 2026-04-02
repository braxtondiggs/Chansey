import { InternalServerErrorException } from '@nestjs/common';

import * as ccxt from 'ccxt';

import * as http from 'http';
import * as https from 'https';

let cachedAgents: { httpAgent: http.Agent; httpsAgent: https.Agent } | null = null;

/**
 * Create HTTP and HTTPS agents that force IPv4 connections.
 * Shared across all exchange services to avoid duplicate agent creation.
 * Returns a cached singleton after the first call.
 */
export function createIPv4Agents(): { httpAgent: http.Agent; httpsAgent: https.Agent } {
  if (!cachedAgents) {
    cachedAgents = {
      httpAgent: new http.Agent({ family: 4 }),
      httpsAgent: new https.Agent({ family: 4 })
    };
  }
  return cachedAgents;
}

/**
 * Create a configured CCXT exchange client.
 * @param exchangeId - The CCXT exchange identifier (e.g. 'binanceus', 'kraken')
 * @param options - Optional credentials and additional config
 * @returns A configured CCXT Exchange instance
 */
export function createCcxtClient(
  exchangeId: keyof typeof ccxt,
  options?: { apiKey?: string; secret?: string; additionalConfig?: object }
): ccxt.Exchange {
  const ccxtExchanges = ccxt as unknown as Record<string, new (config: object) => ccxt.Exchange>;
  const ExchangeClass = ccxtExchanges[exchangeId];

  if (!ExchangeClass || typeof ExchangeClass !== 'function') {
    throw new InternalServerErrorException(`Exchange ${exchangeId} not found in CCXT`);
  }

  const { httpAgent, httpsAgent } = createIPv4Agents();

  return new ExchangeClass({
    ...(options?.apiKey && { apiKey: options.apiKey }),
    ...(options?.secret && { secret: options.secret }),
    enableRateLimit: true,
    agent: httpsAgent,
    httpAgent,
    httpsAgent,
    ...options?.additionalConfig
  });
}
