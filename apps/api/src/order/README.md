# Order Synchronization Feature

This feature keeps orders in the database synchronized with connected exchanges. It ensures that all transactions made
on exchanges are properly reflected in the database.

## Features

- **Automatic Hourly Sync**: Automatically syncs orders for all users with active exchange keys every hour
- **Manual Sync**: Allows users to manually trigger synchronization via API endpoints
- **Admin Sync**: Provides an endpoint for admins to sync orders for all users
- **Cleanup**: Automatically removes stale orders daily at midnight

## API Endpoints

- `POST /api/order/sync` - Manually sync orders for the current user
- `POST /api/order/sync/all` - Admin endpoint to sync orders for all users (requires admin role)

## Implementation Details

The synchronization works by:

1. Checking for active exchange keys for users
2. Using the CCXT library to fetch historical orders from exchanges
3. Processing each supported exchange in parallel for better performance
4. Comparing exchange orders with the database to identify new or updated orders
5. Storing new orders in the database and updating existing ones with proper exchange identification

### Architecture

The order synchronization uses a modular approach:

- `syncOrdersForUser()`: Main entry point that orchestrates sync for all exchanges
- `syncOrdersForExchange()`: Handles sync for a specific exchange
- `saveExchangeOrders()`: Saves orders with proper exchange identification
- `fetchHistoricalOrders()`: Retrieves orders from exchange APIs

This design eliminates code duplication and makes it easy to add new exchanges.

## Configuration

The sync frequency can be modified by changing the cron expressions in `order.task.ts`:

```typescript
@Cron(CronExpression.EVERY_HOUR) // Change to desired frequency
async syncAllUsersOrders() {
  // ...
}

@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT) // Change to desired cleanup frequency
async cleanupStaleOrders() {
  // ...
}
```

## Supported Exchanges

Currently supports:

- **Binance US**: Full order synchronization with fee tracking and market order handling
- **Coinbase**: Complete order sync with commission tracking and price calculation

Additional exchanges can be added by:
1. Adding the exchange service to the `exchangeConfigs` array in `syncOrdersForUser`
2. Implementing the exchange client method
3. Adding exchange identification logic in `saveExchangeOrders`
