import { Coin } from '../coin/coin.interface';
import { Exchange } from '../exchange/exchange.interface';
import { IUser } from '../user/user.interface';

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum OrderStatus {
  NEW = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELED = 'CANCELED',
  PENDING_CANCEL = 'PENDING_CANCEL',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED'
}

export enum OrderType {
  LIMIT = 'LIMIT',
  MARKET = 'MARKET',
  STOP_LOSS = 'STOP_LOSS',
  STOP_LOSS_LIMIT = 'STOP_LOSS_LIMIT',
  TAKE_PROFIT = 'TAKE_PROFIT',
  TAKE_PROFIT_LIMIT = 'TAKE_PROFIT_LIMIT',
  LIMIT_MAKER = 'LIMIT_MAKER',
  STOP = 'STOP'
}

export interface Order {
  id: string;
  symbol: string;
  orderId: string;
  clientOrderId: string;
  transactTime: Date;
  quantity: number;
  price: number;
  executedQuantity: number;
  cost?: number;
  fee?: number;
  commission?: number;
  feeCurrency?: string;
  gainLoss?: number;
  averagePrice?: number;
  status: OrderStatus;
  side: OrderSide;
  type: OrderType;
  user: IUser;
  baseCoin: Coin;
  quoteCoin: Coin;
  exchange?: Exchange;
  createdAt: Date;
  updatedAt: Date;

  // New algorithmic trading fields
  timeInForce?: string;
  stopPrice?: number;
  triggerPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  remaining?: number;
  postOnly?: boolean;
  reduceOnly?: boolean;
  lastTradeTimestamp?: Date;
  lastUpdateTimestamp?: Date;
  trades?: TradeExecution[];
  info?: Record<string, unknown>;
}

export interface TradeExecution {
  id: string;
  timestamp: number;
  price: number;
  amount: number;
  cost: number;
  side: string;
  fee?: {
    cost: number;
    currency: string;
  } | null;
  takerOrMaker?: string;
}

export interface CreateOrderRequest {
  baseCoinId: string;
  quantity: string;
  price?: string;
  type?: OrderType;
  side: OrderSide;
  timeInForce?: string;
  stopPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  postOnly?: boolean;
  reduceOnly?: boolean;
}

export interface OrderSyncStatus {
  totalOrders: number;
  ordersByStatus: Record<string, number>;
  lastSyncTime: Date | null;
  hasActiveExchangeKeys: boolean;
}
