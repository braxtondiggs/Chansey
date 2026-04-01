/**
 * Extract HTTP status code from CoinGecko error messages.
 *
 * The `coingecko-api-v3` library uses Node's `https` module and throws
 * plain `Error` objects with the format:
 *   "got error from coin gecko. status code: <N>"
 *
 * This helper parses that status code so callers can branch on 404, 429, etc.
 */
export function extractCoinGeckoStatusCode(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/status code:\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}
