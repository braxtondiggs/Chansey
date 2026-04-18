import { sanitizeNumericValue } from '../../utils/validators/numeric-sanitizer';
import { type UpdateCoinDto } from '../dto/update-coin.dto';

/**
 * Maps a CoinGecko coin detail response to a metadata-only UpdateCoinDto.
 * Used by the monthly metadata sync to refresh fields that are NOT available
 * on the daily /coins/markets endpoint: description, genesis, scores, sentiment.
 * Links are persisted by the lazy refresh in CoinMarketDataService.
 */
export function mapCoinGeckoDetailToMetadataUpdate(
  coin: Record<string, any>,
  symbol: string
): Pick<UpdateCoinDto, 'description' | 'genesis' | 'sentimentUp' | 'sentimentDown'> {
  return {
    description: coin.description?.en ?? null,
    genesis: coin.genesis_date ?? null,
    sentimentUp: sanitizeNumericValue(coin.sentiment_votes_up_percentage, {
      maxIntegerDigits: 3,
      fieldName: `${symbol}.sentimentUp`,
      allowNegative: false
    }),
    sentimentDown: sanitizeNumericValue(coin.sentiment_votes_down_percentage, {
      maxIntegerDigits: 3,
      fieldName: `${symbol}.sentimentDown`,
      allowNegative: false
    })
  };
}
