# Data Model: Automated Cryptocurrency Trading Platform

**Date**: 2025-09-30
**Purpose**: Define data entities, relationships, and validation rules for brownfield extensions

## Entity Overview

This feature extends 2 existing entities and adds 2 new entities:

**Existing Entities (Extended)**:
1. `Algorithm` - Add performance tracking fields
2. `Order` - Add algorithm tracking field

**New Entities**:
3. `AlgorithmActivation` - User-specific algorithm activation (junction table)
4. `AlgorithmPerformance` - Cached performance metrics and rankings

## 1. Algorithm Entity Extensions

**Location**: `apps/api/src/algorithm/algorithm.entity.ts`

**Existing Fields** (No changes):
- `id: uuid` (PK)
- `name: string` (unique)
- `slug: string`
- `strategyId: string` (nullable)
- `description: string` (nullable)
- `category: AlgorithmCategory` (enum)
- `status: AlgorithmStatus` (enum: ACTIVE, INACTIVE, MAINTENANCE, ERROR)
- `evaluate: boolean`
- `weight: decimal(10,4)` (nullable)
- `cron: string` (cron expression)
- `config: jsonb` (AlgorithmConfig interface)
- `metrics: jsonb` (execution metrics)
- `version: string` (nullable)
- `author: string` (nullable)
- `isFavorite: boolean`
- `createdAt: timestamp`
- `updatedAt: timestamp`

**No Direct Changes Required**:
- Existing `status` field serves global algorithm availability
- Existing `metrics` field tracks execution statistics
- User-specific activation handled by new `AlgorithmActivation` entity

**Relationships** (New):
- One-to-many → `AlgorithmActivation` (user activations)
- One-to-many → `AlgorithmPerformance` (performance rankings)

**Validation Rules**:
- Name must be unique (existing constraint)
- Cron expression must be valid (existing validation)
- Config must conform to AlgorithmConfig interface (existing)

## 2. Order Entity Extensions

**Location**: `apps/api/src/order/order.entity.ts`

**New Fields**:
```typescript
@Column({ type: 'uuid', nullable: true })
@Index('IDX_order_algorithmActivationId')
algorithmActivationId?: string;

@ManyToOne(() => AlgorithmActivation, { nullable: true, onDelete: 'SET NULL' })
algorithmActivation?: AlgorithmActivation;
```

**Field Details**:
- **algorithmActivationId**: Foreign key to `AlgorithmActivation.id`
- **Type**: `uuid`, nullable (null for manual orders)
- **Index**: Required for performance queries (filter orders by algorithm)
- **On Delete**: SET NULL (preserve order history if algorithm activation deleted)

**Validation Rules**:
- If `algorithmActivationId` is set, referenced `AlgorithmActivation` must exist and be active at trade time
- Manual orders have null `algorithmActivationId`

**Migration Notes**:
- Add column as nullable to preserve existing orders
- Add foreign key constraint with ON DELETE SET NULL
- Create index on `algorithmActivationId` for query performance

## 3. AlgorithmActivation Entity (New)

**Location**: `apps/api/src/algorithm/algorithm-activation.entity.ts`

**Purpose**: User-specific algorithm activation state and configuration (junction table between User and Algorithm)

**Fields**:
```typescript
@Entity()
@Index(['userId', 'algorithmId'], { unique: true })  // User can activate algorithm once
@Index(['userId', 'isActive'])                        // Query active algorithms
@Index(['exchangeKeyId'])                             // Query by exchange
export class AlgorithmActivation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'uuid' })
  @Index()
  algorithmId: string;

  @ManyToOne(() => Algorithm, { nullable: false, onDelete: 'CASCADE' })
  algorithm: Algorithm;

  @Column({ type: 'uuid' })
  @Index()
  exchangeKeyId: string;

  @ManyToOne(() => ExchangeKey, { nullable: false, onDelete: 'CASCADE' })
  exchangeKey: ExchangeKey;

  @Column({ type: 'boolean', default: false })
  isActive: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 1.0 })
  allocationPercentage: number;  // % of portfolio per trade (dynamically adjusted by ranking)

  @Column({ type: 'jsonb', nullable: true })
  config?: AlgorithmConfig;  // User-specific overrides to algorithm.config

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deactivatedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

**Relationships**:
- Many-to-one → `User` (CASCADE delete: remove activations if user deleted)
- Many-to-one → `Algorithm` (CASCADE delete: remove activations if algorithm deleted)
- Many-to-one → `ExchangeKey` (CASCADE delete: remove activations if exchange key deleted)
- One-to-many → `Order` (SET NULL: preserve orders if activation deleted)
- One-to-many → `AlgorithmPerformance` (CASCADE delete: remove performance records)

**Validation Rules**:
- Unique constraint on (`userId`, `algorithmId`) - user can only activate algorithm once
- `exchangeKeyId` must reference valid, non-expired exchange key
- `allocationPercentage` must be between 0.01 and 100.00 (0.01% to 100%)
- If `isActive` changes from true to false, set `deactivatedAt` to current timestamp
- If `isActive` changes from false to true, set `activatedAt` to current timestamp

**Indexes**:
- Primary: `id` (uuid PK)
- Unique: `(userId, algorithmId)` - prevent duplicate activations
- Query: `(userId, isActive)` - fetch active algorithms for user
- Query: `exchangeKeyId` - check which algorithms use exchange
- Query: `algorithmId` - count activations per algorithm

**State Transitions**:
```
[Created] → isActive=false, activatedAt=null, deactivatedAt=null
↓ (activate)
[Active] → isActive=true, activatedAt=NOW, deactivatedAt=null
↓ (deactivate)
[Inactive] → isActive=false, activatedAt=<timestamp>, deactivatedAt=NOW
↓ (reactivate)
[Active] → isActive=true, activatedAt=NOW, deactivatedAt=null
```

## 4. AlgorithmPerformance Entity (New)

**Location**: `apps/api/src/algorithm/algorithm-performance.entity.ts`

**Purpose**: Cached performance metrics and rankings (updated by cron job every 5 minutes)

**Fields**:
```typescript
@Entity()
@Index(['algorithmActivationId', 'calculatedAt'])  // Time-series queries
@Index(['userId', 'rank'])                          // Ranking queries
@Index(['calculatedAt'])                            // Cleanup old records
export class AlgorithmPerformance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  algorithmActivationId: string;

  @ManyToOne(() => AlgorithmActivation, { nullable: false, onDelete: 'CASCADE' })
  algorithmActivation: AlgorithmActivation;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user: User;

  // Performance Metrics (comprehensive as per clarifications)

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  roi?: number;  // Return on Investment (%)

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  winRate?: number;  // Win rate (%)

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  sharpeRatio?: number;  // Risk-adjusted return

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  maxDrawdown?: number;  // Maximum drawdown (%)

  @Column({ type: 'integer', default: 0 })
  totalTrades: number;  // Total number of trades

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  riskAdjustedReturn?: number;  // Risk-adjusted return metric

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  volatility?: number;  // Standard deviation of returns

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  alpha?: number;  // Excess return vs market

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  beta?: number;  // Market correlation

  @Column({ type: 'integer', nullable: true })
  rank?: number;  // Ranking among user's algorithms (1 = best)

  @Column({ type: 'timestamptz' })
  calculatedAt: Date;  // When metrics were calculated

  @CreateDateColumn()
  createdAt: Date;
}
```

**Relationships**:
- Many-to-one → `AlgorithmActivation` (CASCADE delete)
- Many-to-one → `User` (CASCADE delete)

**Validation Rules**:
- `totalTrades` must be >= 0
- `winRate` must be between 0 and 100
- `maxDrawdown` must be >= 0
- `rank` must be positive integer if set
- `calculatedAt` must be <= current timestamp

**Indexes**:
- Primary: `id` (uuid PK)
- Time-series: `(algorithmActivationId, calculatedAt)` - fetch historical performance
- Ranking: `(userId, rank)` - order algorithms by performance
- Cleanup: `calculatedAt` - delete old records (retention policy: 90 days)

**Calculation Frequency**:
- Cron job: Every 5 minutes (aligns with trade execution frequency)
- Job: `performance-ranking.task.ts`
- Retention: Keep last 90 days of performance records (26,280 records per activation max)

**Data Volume Estimation**:
- Users: 100 initially
- Algorithms per user: 3-5 average
- Records per day: 288 (every 5 minutes)
- Storage per year per activation: ~105,120 records
- With 3 activations/user × 100 users × 365 days: ~31.5M records/year
- **Optimization**: Store daily aggregates after 7 days, delete minute-level records

## Entity Relationship Diagram

```
User (existing)
  ↓ 1:N
AlgorithmActivation (new)
  ↓ N:1
Algorithm (existing)

AlgorithmActivation
  ↓ N:1
ExchangeKey (existing)

AlgorithmActivation
  ↓ 1:N
Order (extended with algorithmActivationId)

AlgorithmActivation
  ↓ 1:N
AlgorithmPerformance (new)
```

## Database Migration Checklist

**Migration File**: `apps/api/src/migrations/TIMESTAMP-add-algorithm-automation.ts`

**Up Migration**:
1. ✅ Create `algorithm_activations` table
2. ✅ Create `algorithm_performances` table
3. ✅ Add `algorithmActivationId` column to `orders` table (nullable, uuid)
4. ✅ Add foreign key: `orders.algorithmActivationId → algorithm_activations.id` (ON DELETE SET NULL)
5. ✅ Add indexes:
   - `IDX_order_algorithmActivationId` on `orders(algorithmActivationId)`
   - `IDX_algorithm_activation_user_algorithm` on `algorithm_activations(userId, algorithmId)` UNIQUE
   - `IDX_algorithm_activation_user_active` on `algorithm_activations(userId, isActive)`
   - `IDX_algorithm_activation_exchangeKey` on `algorithm_activations(exchangeKeyId)`
   - `IDX_algorithm_performance_activation_calculated` on `algorithm_performances(algorithmActivationId, calculatedAt)`
   - `IDX_algorithm_performance_user_rank` on `algorithm_performances(userId, rank)`

**Down Migration**:
1. Drop indexes
2. Drop foreign key from `orders`
3. Drop `algorithmActivationId` column from `orders`
4. Drop `algorithm_performances` table
5. Drop `algorithm_activations` table

## Data Integrity Constraints

1. **Cascade Deletes**:
   - User deleted → Cascade delete algorithm_activations → Cascade delete algorithm_performances
   - Algorithm deleted → Cascade delete algorithm_activations
   - ExchangeKey deleted → Cascade delete algorithm_activations
   - AlgorithmActivation deleted → SET NULL on orders, CASCADE delete algorithm_performances

2. **Uniqueness**:
   - User can only have ONE activation per algorithm (enforced by unique index)
   - Algorithm name must be unique (existing constraint)

3. **Referential Integrity**:
   - AlgorithmActivation.userId must reference existing user
   - AlgorithmActivation.algorithmId must reference existing algorithm
   - AlgorithmActivation.exchangeKeyId must reference existing, valid exchange key
   - Order.algorithmActivationId must reference existing activation (if not null)

## Query Optimization Strategy

**Common Queries**:
1. Get user's active algorithms: `WHERE userId = ? AND isActive = true` → Uses `IDX_algorithm_activation_user_active`
2. Get orders for algorithm: `WHERE algorithmActivationId = ?` → Uses `IDX_order_algorithmActivationId`
3. Get algorithm ranking: `WHERE userId = ? ORDER BY rank ASC` → Uses `IDX_algorithm_performance_user_rank`
4. Get performance history: `WHERE algorithmActivationId = ? AND calculatedAt >= ?` → Uses `IDX_algorithm_performance_activation_calculated`

**N+1 Query Prevention**:
- Eager load relationships in queries: `relations: ['algorithm', 'exchangeKey', 'algorithmActivation']`
- Use QueryBuilder with joins for complex queries

## Conclusion

Data model complete with 2 entity extensions and 2 new entities. All entities follow brownfield constraints:
- ✅ Co-located with domain modules (algorithm/, order/)
- ✅ TypeORM decorators for schema definition
- ✅ Proper indexing for query performance
- ✅ Cascade delete rules for data integrity
- ✅ Nullable foreign keys where appropriate (preserves historical data)

**Next**: API Contracts (contracts/api-contracts.yaml)
