# Research: Automated Cryptocurrency Trading Platform

**Date**: 2025-09-30
**Purpose**: Document existing codebase patterns and technology choices for brownfield integration

## 1. Existing Algorithm Module Capabilities

**Decision**: Extend existing `Algorithm` entity (apps/api/src/algorithm/algorithm.entity.ts) with user-specific activation tracking

**Current Schema Analysis**:
- **Status field exists**: `AlgorithmStatus` enum with ACTIVE/INACTIVE/MAINTENANCE/ERROR states
- **Metrics tracking exists**: `metrics` jsonb field with `totalExecutions`, `successRate`, `averageExecutionTime`
- **Configuration support**: `config` jsonb field with `AlgorithmConfig` interface for parameters
- **Methods available**: `isActive()`, `hasStrategy()`, `updateMetrics()`, `needsMaintenance()`

**Gaps Identified**:
- No user-specific activation (algorithm activation is global, not per-user)
- No relationship to orders (algorithms don't track which orders they generated)
- No performance ranking or portfolio allocation percentage
- No activation/deactivation timestamps

**Extension Strategy**:
- Create new entity: `AlgorithmActivation` (user-specific many-to-many relationship)
- Add fields: `userId`, `exchangeKeyId`, `isActive`, `activatedAt`, `deactivatedAt`, `allocationPercentage`
- Add relationship: One Algorithm → Many AlgorithmActivations → Many Users
- Preserve existing `Algorithm` entity structure for backward compatibility

**Rationale**: Existing algorithm module is designed for batch evaluation (cron-based), not user-specific trading. Must add user-activation layer without breaking existing evaluation system.

**Alternatives Considered**:
- ❌ Add userId directly to Algorithm entity → Violates single-algorithm-multiple-users requirement
- ✅ Create junction table with activation state → Allows per-user customization

## 2. Existing Order Execution Patterns

**Decision**: Follow established CCXT integration pattern from order-sync.task.ts

**Current CCXT Usage** (apps/api/src/order/tasks/order-sync.task.ts):
```typescript
@Processor('order-queue')
@Injectable()
export class OrderSyncTask extends WorkerHost implements OnModuleInit {
  constructor(
    @InjectQueue('order-queue') private readonly orderQueue: Queue,
    private readonly orderSyncService: OrderSyncService,
    private readonly usersService: UsersService
  ) {}

  async onModuleInit() {
    await this.scheduleOrderSyncJob(); // Schedules EVERY_HOUR cron
  }

  async process(job: Job) {
    // Processes 'sync-orders' and 'cleanup-orders' job types
    const users = await this.usersService.findAllWithExchanges();
    // Fetches orders via CCXT exchange.fetchOrders()
  }
}
```

**Patterns to Follow**:
1. **BullMQ Queue Pattern**: `@Processor('queue-name')` + `extends WorkerHost`
2. **Job Scheduling**: Use `onModuleInit()` to schedule repeatable jobs with cron patterns
3. **Job Configuration**: `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`
4. **Job Retention**: `removeOnComplete: 100`, `removeOnFail: 50`
5. **Service Injection**: Delegate CCXT operations to dedicated service (OrderSyncService pattern)

**New Queue Requirements**:
- **Queue Name**: `trade-execution-queue`
- **Job Types**: `execute-trade` (processes algorithm signals)
- **Cron Pattern**: `EVERY_5_MINUTES` (acceptable 5-minute latency per clarifications)
- **Processor**: `TradeExecutionTask extends WorkerHost`

**Rationale**: Existing pattern proven stable for hourly order synchronization processing 100+ orders/second. Trade execution requires same reliability with faster frequency.

**Alternatives Considered**:
- ❌ Real-time WebSocket-driven execution → Adds complexity, 5-minute latency acceptable
- ✅ BullMQ cron job every 5 minutes → Fits existing infrastructure, simple to implement

## 3. Existing BullMQ Queue Configuration

**Decision**: Register new `trade-execution` queue in app.module.ts following existing patterns

**Current Queue Registration** (apps/api/src/app.module.ts analysis):
- Uses `@nestjs/bullmq` module
- Queues registered in `BullModule.registerQueue()` array
- Redis connection configured via environment variables
- Each queue has dedicated processor file in `tasks/` subdirectory

**New Queue Registration Pattern**:
```typescript
// In app.module.ts
BullModule.registerQueue(
  { name: 'order-queue' },     // existing
  { name: 'trade-execution' }  // new
)

// In order.module.ts
@Module({
  imports: [
    BullModule.registerQueue({ name: 'trade-execution' })
  ],
  providers: [
    OrderService,
    TradeExecutionTask  // new processor
  ]
})
```

**Configuration Checklist**:
- ✅ Redis connection reuse (existing `REDIS_URL` environment variable)
- ✅ Queue name convention: kebab-case (`trade-execution` not `tradeExecution`)
- ✅ Processor location: `apps/api/src/order/tasks/trade-execution.task.ts`
- ✅ Module registration: Import BullModule in `order.module.ts`

**Rationale**: Consistency with existing queue infrastructure ensures operational familiarity and monitoring compatibility.

## 4. Algorithm Performance Calculation Patterns

**Decision**: Use `technicalindicators` npm package for financial metrics calculation

**Research Findings**:
- **@debut/indicators**: Good for TA indicators, lacks comprehensive financial metrics (Sharpe, alpha/beta)
- **technicalindicators**: Has `SharpeRatio`, comprehensive TA library, actively maintained
- **Custom implementation**: Requires extensive testing, reinventing wheel

**Metrics Calculation Strategy**:
1. **ROI (Return on Investment)**:
   ```typescript
   roi = ((finalValue - initialValue) / initialValue) * 100
   ```
2. **Win Rate**:
   ```typescript
   winRate = (profitableTrades / totalTrades) * 100
   ```
3. **Sharpe Ratio**:
   ```typescript
   import { SharpeRatio } from 'technicalindicators';
   sharpe = SharpeRatio.calculate({ values: returns, riskFreeRate: 0 });
   ```
4. **Max Drawdown**:
   ```typescript
   // Custom implementation: Track peak value, calculate max percentage drop
   maxDrawdown = ((peakValue - troughValue) / peakValue) * 100
   ```
5. **Volatility**:
   ```typescript
   import { StandardDeviation } from 'technicalindicators';
   volatility = StandardDeviation.calculate({ values: returns, period: returns.length });
   ```
6. **Alpha/Beta**:
   - **Alpha**: Excess return vs market benchmark
   - **Beta**: Correlation with market (use Bitcoin as benchmark for crypto)
   - Requires market data comparison (can defer to v2 if complex)

**Implementation Location**:
- **Service**: `apps/api/src/algorithm/services/algorithm-performance.service.ts`
- **Task**: `apps/api/src/algorithm/tasks/performance-ranking.task.ts` (cron every 5 minutes)
- **Entity**: `apps/api/src/algorithm/algorithm-performance.entity.ts` (cache calculations)

**Rationale**: `technicalindicators` provides battle-tested implementations, reduces risk of calculation errors in financial metrics.

**Alternatives Considered**:
- ❌ pandas-js (Python port) → Heavy dependency, overkill for this use case
- ❌ Custom formulas → High error risk for complex metrics like Sharpe ratio
- ✅ technicalindicators → Lightweight, comprehensive, TypeScript-friendly

## 5. Frontend State Management Patterns

**Decision**: Use TanStack Query (Angular Query) pattern from existing portfolio components

**Current Pattern Analysis** (apps/chansey/src/app/portfolio/*):
Expected patterns based on constitution:
- Standalone Angular components (no NgModules)
- TanStack Query hooks for data fetching
- PrimeNG components for UI (p-table, p-chart, p-card, p-button)
- Loading/error states via query.isLoading, query.error

**Component Structure Template**:
```typescript
// Algorithm Dashboard Component
@Component({
  standalone: true,
  imports: [CommonModule, PrimeNG components],
  providers: [injectQuery],
  template: `
    <p-card *ngIf="algorithmsQuery.isLoading">Loading...</p-card>
    <p-card *ngIf="algorithmsQuery.error">Error: {{ algorithmsQuery.error }}</p-card>
    <p-table *ngIf="algorithmsQuery.data" [value]="algorithmsQuery.data">
      <!-- Algorithm metrics table -->
    </p-table>
    <p-chart [data]="performanceChartData" type="line"></p-chart>
  `
})
export class AlgorithmDashboardComponent {
  algorithmsQuery = injectQuery({
    queryKey: ['algorithms', 'active'],
    queryFn: () => this.http.get('/api/algorithms/active')
  });
}
```

**Query Patterns**:
1. **List Query**: `['algorithms']` → GET /api/algorithms
2. **Detail Query**: `['algorithms', id]` → GET /api/algorithms/:id
3. **Performance Query**: `['algorithms', id, 'performance']` → GET /api/algorithms/:id/performance
4. **Mutation**: `useMutation()` for activation → POST /api/algorithms/:id/activate

**Rationale**: TanStack Query provides automatic caching, refetching, and loading state management reducing boilerplate. Consistency with existing patterns accelerates development.

**Alternatives Considered**:
- ❌ NgRx store → Too heavy for this feature scope, adds complexity
- ❌ Plain HttpClient → Manual loading/error state management, no caching
- ✅ TanStack Query → Matches constitutional requirements, proven pattern

## 6. Database Migration Strategy

**Decision**: Single migration file to add all automated trading schema changes

**Migration Scope**:
1. Create `algorithm_activations` table (user-algorithm junction)
2. Create `algorithm_performances` table (cached performance metrics)
3. Add `algorithmActivationId` foreign key to `orders` table (nullable, for automated orders)
4. Add indexes: `(userId, algorithmId)`, `(userId, rank)`, `(algorithmActivationId)`

**Migration File**: `apps/api/src/migrations/TIMESTAMP-add-algorithm-automation.ts`

**TypeORM Migration Pattern**:
```typescript
export class AddAlgorithmAutomation1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create tables, add foreign keys, create indexes
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback changes
  }
}
```

**Rationale**: Single migration ensures atomic schema changes, simplifies rollback, follows existing migration patterns in `apps/api/src/migrations/`.

## Summary

All research complete with concrete decisions:
1. ✅ Extend Algorithm module with `AlgorithmActivation` junction table (user-specific)
2. ✅ Follow BullMQ pattern from order-sync.task.ts for new `trade-execution` queue
3. ✅ Register queue in app.module.ts, processor in order.module.ts
4. ✅ Use `technicalindicators` npm package for Sharpe ratio, volatility calculations
5. ✅ Follow TanStack Query pattern for Angular dashboard components
6. ✅ Single TypeORM migration for all schema changes

**Next Phase**: Design & Contracts (data-model.md, api-contracts.yaml, quickstart.md)
