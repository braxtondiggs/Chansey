import { type PositionExitStatus } from './exit-config.interface';

/**
 * Event name constants for EventEmitter2. Listeners (e.g. ListingExitListener)
 * use these to react to exit-order fills without coupling OrderModule to
 * downstream strategy modules.
 */
export const ORDER_EVENTS = {
  POSITION_EXIT_FILLED: 'order.position-exit-filled'
} as const;

/**
 * Emitted when an OCO exit leg fills (SL/TP/trailing). Not emitted for
 * CANCELLED, EXPIRED, or ERROR transitions — consumers react to actual
 * market-closing fills only.
 */
export interface PositionExitFilledPayload {
  positionExitId: string;
  entryOrderId: string;
  userId: string;
  status: PositionExitStatus;
  exitPrice: number | null;
  realizedPnL: number | null;
}
