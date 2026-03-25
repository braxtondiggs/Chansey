export interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  lastUpdated: Date;
}

export interface TradeEstimate {
  estimatedPrice: number;
  estimatedQuantity: number;
  estimatedTotal: number;
  fees: number;
  slippage?: number;
  impact?: number;
}
