/**
 * Kraken uses legacy pre-ISO short codes for some base assets.
 * Source of truth for the `XBT ⇔ BTC`, `XDG ⇔ DOGE` mapping.
 */
export const KRAKEN_BASE_ALIASES: Readonly<Record<string, string>> = {
  XBT: 'BTC',
  XDG: 'DOGE'
};

/** Inverse lookup for canonical → Kraken (e.g. `BTC → XBT`). */
export const KRAKEN_BASE_ALIASES_INVERSE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(KRAKEN_BASE_ALIASES).map(([k, v]) => [v, k])
);

/** Kraken uses prefixed codes for fiat quotes (ZUSD, ZEUR, etc.). */
export const KRAKEN_QUOTE_ALIASES: Readonly<Record<string, string>> = {
  ZUSD: 'USD'
};

/** Inverse lookup for canonical → Kraken (e.g. `USD → ZUSD`). */
export const KRAKEN_QUOTE_ALIASES_INVERSE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(KRAKEN_QUOTE_ALIASES).map(([k, v]) => [v, k])
);
