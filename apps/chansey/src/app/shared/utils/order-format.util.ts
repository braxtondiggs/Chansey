import { Order } from '@chansey/api-interfaces';

export function isUsdQuote(transaction: Order): boolean {
  const coinSymbol = transaction.quoteCoin?.symbol?.toUpperCase();
  if (coinSymbol === 'USD' || coinSymbol === 'USDT' || coinSymbol === 'USDC' || coinSymbol === 'BUSD') {
    return true;
  }
  const quote = transaction.symbol?.split('/')?.[1]?.toUpperCase();
  return quote === 'USD' || quote === 'USDT' || quote === 'USDC' || quote === 'BUSD';
}

export function formatType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
