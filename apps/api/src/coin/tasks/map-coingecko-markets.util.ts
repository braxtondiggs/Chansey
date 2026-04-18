import { sanitizeNumericValue } from '../../utils/validators/numeric-sanitizer';
import { type UpdateCoinDto } from '../dto/update-coin.dto';

/**
 * Maps a CoinGecko /coins/markets entry to an UpdateCoinDto.
 * Pure function — no side effects, no DI dependencies.
 *
 * Only touches fields the markets endpoint returns: price, market cap, volume,
 * supply, ATH/ATL, price-change percentages, and image. Metadata fields
 * (description, genesis, links, scores, sentiment) are intentionally omitted
 * and sourced from the monthly /coins/{id} sync instead.
 */
export function mapCoinGeckoMarketsToUpdate(
  entry: Record<string, any>,
  geckoRank: number | null | undefined,
  symbol: string
): UpdateCoinDto {
  return {
    image: entry.image ?? null,
    marketRank: entry.market_cap_rank ?? null,
    geckoRank: geckoRank ?? null,
    totalSupply: sanitizeNumericValue(entry.total_supply, {
      fieldName: `${symbol}.totalSupply`,
      allowNegative: false
    }),
    totalVolume: sanitizeNumericValue(entry.total_volume, {
      fieldName: `${symbol}.totalVolume`,
      allowNegative: false
    }),
    circulatingSupply: sanitizeNumericValue(entry.circulating_supply, {
      fieldName: `${symbol}.circulatingSupply`,
      allowNegative: false
    }),
    maxSupply: sanitizeNumericValue(entry.max_supply, {
      fieldName: `${symbol}.maxSupply`,
      allowNegative: false
    }),
    marketCap: sanitizeNumericValue(entry.market_cap, {
      fieldName: `${symbol}.marketCap`,
      allowNegative: false
    }),
    currentPrice: sanitizeNumericValue(entry.current_price, {
      maxIntegerDigits: 17,
      fieldName: `${symbol}.currentPrice`,
      allowNegative: false
    }),
    ath: sanitizeNumericValue(entry.ath, {
      maxIntegerDigits: 17,
      fieldName: `${symbol}.ath`,
      allowNegative: false
    }),
    atl: sanitizeNumericValue(entry.atl, {
      maxIntegerDigits: 17,
      fieldName: `${symbol}.atl`,
      allowNegative: false
    }),
    athDate: entry.ath_date ?? null,
    atlDate: entry.atl_date ?? null,
    athChange: sanitizeNumericValue(entry.ath_change_percentage, {
      maxIntegerDigits: 4,
      fieldName: `${symbol}.athChange`
    }),
    atlChange: sanitizeNumericValue(entry.atl_change_percentage, {
      maxIntegerDigits: 9,
      fieldName: `${symbol}.atlChange`
    }),
    priceChange24h: sanitizeNumericValue(entry.price_change_24h, {
      maxIntegerDigits: 17,
      fieldName: `${symbol}.priceChange24h`
    }),
    priceChangePercentage24h: sanitizeNumericValue(entry.price_change_percentage_24h, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage24h`
    }),
    priceChangePercentage7d: sanitizeNumericValue(entry.price_change_percentage_7d_in_currency, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage7d`
    }),
    priceChangePercentage14d: sanitizeNumericValue(entry.price_change_percentage_14d_in_currency, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage14d`
    }),
    priceChangePercentage30d: sanitizeNumericValue(entry.price_change_percentage_30d_in_currency, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage30d`
    }),
    priceChangePercentage200d: sanitizeNumericValue(entry.price_change_percentage_200d_in_currency, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage200d`
    }),
    priceChangePercentage1y: sanitizeNumericValue(entry.price_change_percentage_1y_in_currency, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage1y`
    }),
    marketCapChange24h: sanitizeNumericValue(entry.market_cap_change_24h, {
      fieldName: `${symbol}.marketCapChange24h`
    }),
    marketCapChangePercentage24h: sanitizeNumericValue(entry.market_cap_change_percentage_24h, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.marketCapChangePercentage24h`
    }),
    geckoLastUpdatedAt: entry.last_updated ?? null
  };
}
