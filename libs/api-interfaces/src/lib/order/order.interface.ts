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
  MARKET = 'market',
  LIMIT = 'limit',
  STOP_LOSS = 'stop_loss',
  STOP_LIMIT = 'stop_limit',
  TRAILING_STOP = 'trailing_stop',
  TAKE_PROFIT = 'take_profit',
  OCO = 'oco'
}

export enum TrailingType {
  AMOUNT = 'amount',
  PERCENTAGE = 'percentage'
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

  // Manual order support
  isManual?: boolean;
  exchangeKeyId?: string;

  // Order type specific parameters
  timeInForce?: string;
  stopPrice?: number;
  triggerPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  trailingAmount?: number;
  trailingType?: TrailingType;
  ocoLinkedOrderId?: string;

  // Algorithmic trading fields
  algorithmActivationId?: string;
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
  quoteCoinId?: string;
  exchangeId?: string;
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

export interface PlaceManualOrderRequest {
  exchangeKeyId: string;
  symbol: string;
  orderType: OrderType;
  side: OrderSide;
  quantity: number;
  price?: number;
  stopPrice?: number;
  trailingAmount?: number;
  trailingType?: TrailingType;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  ocoLinkedOrderId?: string;
  timeInForce?: string;
}

export interface OrderPreviewRequest {
  exchangeKeyId: string;
  symbol: string;
  orderType: OrderType;
  side: OrderSide;
  quantity: number;
  price?: number;
  stopPrice?: number;
  trailingAmount?: number;
  trailingType?: TrailingType;
}

export interface OrderSyncStatus {
  totalOrders: number;
  ordersByStatus: Record<string, number>;
  lastSyncTime: Date | null;
  hasActiveExchangeKeys: boolean;
}

export interface OrderPreview {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  trailingAmount?: number;
  trailingType?: TrailingType;
  estimatedCost: number;
  estimatedFee: number;
  feeCurrency: string;
  totalRequired: number;
  marketPrice?: number;
  availableBalance: number;
  balanceCurrency: string;
  hasSufficientBalance: boolean;
  priceDeviation?: number;
  warnings?: string[];
  exchange: string;
}
