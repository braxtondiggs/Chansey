# Phase 1: Data Model & Entity Design

**Feature**: Manual Order Placement System Overhaul
**Date**: 2025-10-08

## Entity Extensions

### Order Entity (Extend Existing)

**Location**: `apps/api/src/order/order.entity.ts`

**Existing Fields** (preserve):
```typescript
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => ExchangeKey)
  @JoinColumn({ name: 'exchange_key_id' })
  exchangeKey: ExchangeKey;

  @Column()
  symbol: string;  // e.g., "BTC/USDT"

  @Column()
  side: 'buy' | 'sell';

  @Column('decimal', { precision: 20, scale: 8 })
  quantity: number;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  price: number;  // null for market orders

  @Column()
  status: string;  // open, filled, partially_filled, canceled, rejected, expired

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  fee: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  filledQuantity: number;

  @Column({ name: 'exchange_order_id', nullable: true })
  exchangeOrderId: string;  // ID from exchange

  @ManyToOne(() => AlgorithmActivation, { nullable: true })
  @JoinColumn({ name: 'algorithm_activation_id' })
  algorithmActivation: AlgorithmActivation;  // null for manual orders

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

**New Fields to Add**:
```typescript
@Column({ name: 'is_manual', default: false })
isManual: boolean;  // true for manual orders, false for automated

@Column({
  name: 'order_type',
  type: 'enum',
  enum: OrderType,
  default: OrderType.MARKET
})
orderType: OrderType;  // market, limit, stop_loss, stop_limit, trailing_stop, take_profit, oco

@Column('decimal', {
  name: 'stop_price',
  precision: 20,
  scale: 8,
  nullable: true
})
stopPrice: number;  // For stop-loss and stop-limit orders

@Column('decimal', {
  name: 'trailing_amount',
  precision: 20,
  scale: 8,
  nullable: true
})
trailingAmount: number;  // For trailing stop orders (absolute amount or percentage)

@Column({
  name: 'trailing_type',
  type: 'enum',
  enum: TrailingType,
  nullable: true
})
trailingType: TrailingType;  // 'amount' or 'percentage'

@Column('decimal', {
  name: 'take_profit_price',
  precision: 20,
  scale: 8,
  nullable: true
})
takeProfitPrice: number;  // For take-profit and OCO orders

@Column('decimal', {
  name: 'stop_loss_price',
  precision: 20,
  scale: 8,
  nullable: true
})
stopLossPrice: number;  // For OCO orders

@Column({
  name: 'oco_linked_order_id',
  nullable: true
})
ocoLinkedOrderId: string;  // For OCO orders, references the paired order
```

**Relationships** (existing, preserve):
- `User` (ManyToOne): Order belongs to a user
- `ExchangeKey` (ManyToOne): Order executed on specific exchange
- `AlgorithmActivation` (ManyToOne, nullable): Links automated orders to algorithm

**Validation Rules**:
- `isManual = true` → `algorithmActivation` MUST be null
- `isManual = false` → `algorithmActivation` SHOULD NOT be null (existing automated orders)
- `orderType = 'market'` → `price` SHOULD be null
- `orderType = 'limit'` → `price` MUST NOT be null
- `orderType IN ('stop_loss', 'stop_limit')` → `stopPrice` MUST NOT be null
- `orderType = 'trailing_stop'` → `trailingAmount` and `trailingType` MUST NOT be null
- `orderType = 'take_profit'` → `takeProfitPrice` MUST NOT be null
- `orderType = 'oco'` → `takeProfitPrice`, `stopLossPrice`, and `ocoLinkedOrderId` MUST NOT be null

**Indexes** (create via migration):
```sql
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE INDEX idx_orders_user_type ON orders(user_id, order_type);
CREATE INDEX idx_orders_manual ON orders(is_manual, user_id);
CREATE INDEX idx_orders_exchange_key ON orders(exchange_key_id, status);
```

## Enums

### OrderType Enum

**Location**: `libs/api-interfaces/src/lib/order.interface.ts`

```typescript
export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP_LOSS = 'stop_loss',
  STOP_LIMIT = 'stop_limit',
  TRAILING_STOP = 'trailing_stop',
  TAKE_PROFIT = 'take_profit',
  OCO = 'oco'  // One-Cancels-Other
}
```

### TrailingType Enum

**Location**: `libs/api-interfaces/src/lib/order.interface.ts`

```typescript
export enum TrailingType {
  AMOUNT = 'amount',        // Absolute price amount (e.g., $100)
  PERCENTAGE = 'percentage' // Percentage (e.g., 2%)
}
```

### OrderStatus Enum (existing, document for reference)

```typescript
export enum OrderStatus {
  NEW = 'new',                     // Order created, not yet submitted
  OPEN = 'open',                   // Order submitted to exchange, active
  FILLED = 'filled',               // Order completely filled
  PARTIALLY_FILLED = 'partially_filled',  // Order partially executed
  CANCELED = 'canceled',           // Order canceled by user
  REJECTED = 'rejected',           // Order rejected by exchange
  EXPIRED = 'expired'              // Order expired (time-in-force)
}
```

## DTOs

### CreateManualOrderDto

**Location**: `apps/api/src/order/dto/create-manual-order.dto.ts`

```typescript
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsUUID, Min, ValidateIf } from 'class-validator';
import { OrderType, TrailingType } from '@chansey/api-interfaces';

export class CreateManualOrderDto {
  @IsUUID()
  @IsNotEmpty()
  exchangeKeyId: string;  // Which exchange to place order on

  @IsNotEmpty()
  symbol: string;  // e.g., "BTC/USDT"

  @IsEnum(OrderType)
  @IsNotEmpty()
  orderType: OrderType;

  @IsEnum(['buy', 'sell'])
  @IsNotEmpty()
  side: 'buy' | 'sell';

  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  quantity: number;

  // Required for limit orders
  @ValidateIf(o => o.orderType === OrderType.LIMIT || o.orderType === OrderType.STOP_LIMIT)
  @IsNumber()
  @IsPositive()
  price: number;

  // Required for stop orders
  @ValidateIf(o =>
    o.orderType === OrderType.STOP_LOSS ||
    o.orderType === OrderType.STOP_LIMIT
  )
  @IsNumber()
  @IsPositive()
  stopPrice: number;

  // Required for trailing stop
  @ValidateIf(o => o.orderType === OrderType.TRAILING_STOP)
  @IsNumber()
  @IsPositive()
  trailingAmount: number;

  @ValidateIf(o => o.orderType === OrderType.TRAILING_STOP)
  @IsEnum(TrailingType)
  trailingType: TrailingType;

  // Required for take-profit
  @ValidateIf(o => o.orderType === OrderType.TAKE_PROFIT || o.orderType === OrderType.OCO)
  @IsNumber()
  @IsPositive()
  takeProfitPrice: number;

  // Required for OCO
  @ValidateIf(o => o.orderType === OrderType.OCO)
  @IsNumber()
  @IsPositive()
  stopLossPrice: number;
}
```

### OrderPreviewResponseDto

**Location**: `apps/api/src/order/dto/order-preview.dto.ts`

```typescript
export class OrderPreviewResponseDto {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: OrderType;
  quantity: number;
  price: number | null;  // null for market orders

  // Cost breakdown
  currentMarketPrice: number;
  estimatedCost: number;  // quantity * price (or market price)
  estimatedFee: number;   // Based on exchange fee structure
  estimatedTotal: number; // cost + fee

  // Available balance
  availableBalance: number;
  requiredBalance: number;  // estimatedTotal
  sufficientBalance: boolean;

  // Order-specific fields
  stopPrice?: number;
  trailingAmount?: number;
  trailingType?: TrailingType;
  takeProfitPrice?: number;
  stopLossPrice?: number;

  // Warnings
  warnings: string[];  // e.g., "Price is 150% above market"

  // Exchange info
  exchangeName: string;
  minOrderSize: number;
  maxOrderSize: number;
  pricePrecision: number;
  quantityPrecision: number;
}
```

### OrderFilterDto (Extend Existing)

**Location**: `apps/api/src/order/dto/order-filter.dto.ts`

```typescript
// Add new fields to existing DTO
export class OrderFilterDto {
  // Existing fields
  @IsOptional()
  @IsUUID()
  exchangeKeyId?: string;

  @IsOptional()
  status?: string;

  @IsOptional()
  symbol?: string;

  // NEW: Filter by order type
  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  // NEW: Filter manual vs automated
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isManual?: boolean;

  // NEW: Date range filtering
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  // Pagination (existing)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
```

## State Transitions

### Order Lifecycle

```
[USER CREATES ORDER]
        ↓
    NEW (local DB)
        ↓
[SUBMIT TO EXCHANGE via CCXT]
        ↓
    OPEN (active on exchange)
        ↓
    ├─→ FILLED (100% executed)
    ├─→ PARTIALLY_FILLED (partial execution)
    │       ↓
    │   FILLED or CANCELED
    ├─→ CANCELED (user cancels or system cancels)
    ├─→ REJECTED (exchange rejects)
    └─→ EXPIRED (time-based expiration)
```

**State Transition Rules**:
1. `NEW → OPEN`: Order submitted successfully to exchange
2. `OPEN → FILLED`: Order fully executed
3. `OPEN → PARTIALLY_FILLED`: Partial execution
4. `PARTIALLY_FILLED → FILLED`: Remaining quantity filled
5. `OPEN|PARTIALLY_FILLED → CANCELED`: User cancels or system cancels
6. `NEW|OPEN → REJECTED`: Exchange rejects order (validation, balance, etc.)
7. `OPEN → EXPIRED`: Time-in-force expiration

**Invalid Transitions**:
- `FILLED → CANCELED`: Cannot cancel filled order
- `CANCELED → OPEN`: Cannot reopen canceled order
- `REJECTED → OPEN`: Cannot resubmit rejected order (must create new)

## Validation Matrix

### Order Type Parameter Requirements

| Order Type    | price | stopPrice | trailingAmount | trailingType | takeProfitPrice | stopLossPrice |
|---------------|-------|-----------|----------------|--------------|-----------------|---------------|
| Market        | ❌    | ❌        | ❌             | ❌           | ❌              | ❌            |
| Limit         | ✅    | ❌        | ❌             | ❌           | ❌              | ❌            |
| Stop Loss     | ❌    | ✅        | ❌             | ❌           | ❌              | ❌            |
| Stop Limit    | ✅    | ✅        | ❌             | ❌           | ❌              | ❌            |
| Trailing Stop | ❌    | ❌        | ✅             | ✅           | ❌              | ❌            |
| Take Profit   | ❌    | ❌        | ❌             | ❌           | ✅              | ❌            |
| OCO           | ❌    | ❌        | ❌             | ❌           | ✅              | ✅            |

✅ = Required | ❌ = Not applicable

### Business Validation Rules

**Balance Validation** (FR-003, FR-012):
- For BUY orders: `availableQuoteBalance >= (quantity * price) + estimatedFee`
- For SELL orders: `availableBaseBalance >= quantity`

**Exchange Limits** (FR-008):
- `quantity >= exchange.markets[symbol].limits.amount.min`
- `quantity <= exchange.markets[symbol].limits.amount.max`
- `price * quantity >= exchange.markets[symbol].limits.cost.min` (if applicable)

**Precision Validation** (FR-010, FR-011):
- `price` decimals <= `exchange.markets[symbol].precision.price`
- `quantity` decimals <= `exchange.markets[symbol].precision.amount`

**Stop Price Logic** (FR-002b):
- For SELL stop-loss: `stopPrice < currentMarketPrice`
- For BUY stop-loss: `stopPrice > currentMarketPrice`
- For stop-limit: `price` and `stopPrice` must satisfy above rules

**OCO Logic**:
- `takeProfitPrice` and `stopLossPrice` must be on opposite sides of market
- For SELL OCO: `takeProfitPrice > currentMarketPrice > stopLossPrice`
- For BUY OCO: `takeProfitPrice < currentMarketPrice < stopLossPrice`

**Warning Conditions** (FR-013):
- Price deviation >50% from market: Display warning
- Very large order (>10% of 24h volume): Display warning
- Unusual order size (outside user's typical range): Display warning

## Integration with Existing Entities

### Relationships

**User → Orders** (1:N, existing):
- User can have multiple manual orders
- User can have multiple automated orders (via AlgorithmActivation)

**ExchangeKey → Orders** (1:N, existing):
- Orders placed via specific exchange connection
- Each ExchangeKey belongs to one User and one Exchange

**AlgorithmActivation → Orders** (1:N, existing):
- For automated orders: `isManual = false`, `algorithmActivation != null`
- For manual orders: `isManual = true`, `algorithmActivation = null`

### Data Integrity Constraints

```sql
-- Manual orders cannot have algorithm activation
ALTER TABLE orders ADD CONSTRAINT chk_manual_no_algorithm
  CHECK (NOT (is_manual = true AND algorithm_activation_id IS NOT NULL));

-- Order type must have required parameters
ALTER TABLE orders ADD CONSTRAINT chk_stop_price_required
  CHECK (
    (order_type IN ('stop_loss', 'stop_limit') AND stop_price IS NOT NULL) OR
    (order_type NOT IN ('stop_loss', 'stop_limit') AND stop_price IS NULL)
  );

-- Similar constraints for other order-type-specific fields
```

## Migration Strategy

**Migration File**: `apps/api/src/migrations/1728XXXXXXX-AddManualOrderSupport.ts`

**Steps**:
1. Add new columns with nullable constraints
2. Set default values for existing records:
   - `isManual = false` (existing orders are automated)
   - `orderType = 'market'` (safe assumption for historical data)
3. Create indexes for performance
4. Add check constraints for data integrity

**Rollback Strategy**:
- Drop new columns
- Drop new indexes
- Drop check constraints

**Data Migration**:
- No data transformation needed for existing records
- New fields default to null/false, preserving existing functionality

---
*Data model design completed: 2025-10-08*
