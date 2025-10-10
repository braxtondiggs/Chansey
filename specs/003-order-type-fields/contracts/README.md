# API Contracts

This feature uses existing API endpoints - no new contracts needed.

## Existing Endpoints Used

### GET /order
Returns list of user's orders with filtering options.

**Contract Location**: `apps/api/src/order/order.controller.ts` (lines 22-43)

**Response Type**: `OrderResponseDto[]`

### POST /order/manual/preview
Previews a manual order to calculate costs and fees.

**Contract Location**: `apps/api/src/order/order.controller.ts` (lines 124-144)

**Request Type**: `OrderPreviewRequestDto`
**Response Type**: `OrderPreviewDto`

### POST /order/manual
Places a manual order on the exchange.

**Contract Location**: `apps/api/src/order/order.controller.ts` (lines 98-122)

**Request Type**: `PlaceManualOrderDto`
**Response Type**: `OrderResponseDto`

### DELETE /order/:id
Cancels an open order.

**Contract Location**: `apps/api/src/order/order.controller.ts` (lines 146-176)

**Response Type**: `OrderResponseDto`

## Contract Testing

All contracts are fully implemented and tested in:
- `apps/api/src/order/order.controller.spec.ts`
- `apps/api/src/order/order.service.spec.ts`
- `apps/api/src/order/dto/order.dto.spec.ts`

No new contract tests required for this UI enhancement.
