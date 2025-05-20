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
3. Comparing exchange orders with the database to identify new or updated orders
4. Storing new orders in the database and updating existing ones

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

- Binance US

Additional exchanges can be added by implementing similar methods for other supported CCXT exchanges.
