/** Metadata keys that appear alongside real asset entries in CCXT fetchBalance() */
export const CCXT_BALANCE_META_KEYS = new Set(['info', 'free', 'used', 'total', 'timestamp', 'datetime']);

/** Returns true if the key is a real asset (not CCXT metadata) */
export function isCcxtAssetKey(key: string): boolean {
  return !CCXT_BALANCE_META_KEYS.has(key);
}
