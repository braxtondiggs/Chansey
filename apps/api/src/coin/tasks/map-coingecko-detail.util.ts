import { sanitizeNumericValue } from '../../utils/validators/numeric-sanitizer';
import { UpdateCoinDto } from '../dto/update-coin.dto';

/**
 * Maps a CoinGecko coin detail response to an UpdateCoinDto.
 * Pure function — no side effects, no DI dependencies.
 */
export function mapCoinGeckoDetailToUpdate(
  coin: Record<string, any>,
  geckoRank: number | null | undefined,
  symbol: string
): UpdateCoinDto {
  const md = coin.market_data;

  return {
    description: coin.description?.en ?? null,
    image: coin.image?.large ?? coin.image?.small ?? coin.image?.thumb ?? null,
    genesis: coin.genesis_date ?? null,
    totalSupply: sanitizeNumericValue(md?.total_supply, {
      fieldName: `${symbol}.totalSupply`,
      allowNegative: false
    }),
    totalVolume: sanitizeNumericValue(md?.total_volume?.usd, {
      fieldName: `${symbol}.totalVolume`,
      allowNegative: false
    }),
    circulatingSupply: sanitizeNumericValue(md?.circulating_supply, {
      fieldName: `${symbol}.circulatingSupply`,
      allowNegative: false
    }),
    maxSupply: sanitizeNumericValue(md?.max_supply, {
      fieldName: `${symbol}.maxSupply`,
      allowNegative: false
    }),
    marketRank: coin.market_cap_rank ?? null,
    marketCap: sanitizeNumericValue(md?.market_cap?.usd, {
      fieldName: `${symbol}.marketCap`,
      allowNegative: false
    }),
    geckoRank: coin.coingecko_rank ?? geckoRank ?? null,
    developerScore: sanitizeNumericValue(coin.developer_score, {
      maxIntegerDigits: 3,
      fieldName: `${symbol}.developerScore`,
      allowNegative: false
    }),
    communityScore: sanitizeNumericValue(coin.community_score, {
      maxIntegerDigits: 3,
      fieldName: `${symbol}.communityScore`,
      allowNegative: false
    }),
    liquidityScore: sanitizeNumericValue(coin.liquidity_score, {
      maxIntegerDigits: 3,
      fieldName: `${symbol}.liquidityScore`,
      allowNegative: false
    }),
    publicInterestScore: sanitizeNumericValue(coin.public_interest_score, {
      maxIntegerDigits: 3,
      fieldName: `${symbol}.publicInterestScore`,
      allowNegative: false
    }),
    sentimentUp: sanitizeNumericValue(coin.sentiment_votes_up_percentage, {
      maxIntegerDigits: 3,
      fieldName: `${symbol}.sentimentUp`,
      allowNegative: false
    }),
    sentimentDown: sanitizeNumericValue(coin.sentiment_votes_down_percentage, {
      maxIntegerDigits: 3,
      fieldName: `${symbol}.sentimentDown`,
      allowNegative: false
    }),
    ath: sanitizeNumericValue(md?.ath?.usd, {
      maxIntegerDigits: 17,
      fieldName: `${symbol}.ath`,
      allowNegative: false
    }),
    atl: sanitizeNumericValue(md?.atl?.usd, {
      maxIntegerDigits: 17,
      fieldName: `${symbol}.atl`,
      allowNegative: false
    }),
    athDate: md?.ath_date?.usd ?? null,
    atlDate: md?.atl_date?.usd ?? null,
    athChange: sanitizeNumericValue(md?.ath_change_percentage?.usd, {
      maxIntegerDigits: 4,
      fieldName: `${symbol}.athChange`
    }),
    atlChange: sanitizeNumericValue(md?.atl_change_percentage?.usd, {
      maxIntegerDigits: 9,
      fieldName: `${symbol}.atlChange`
    }),
    priceChange24h: sanitizeNumericValue(md?.price_change_24h, {
      maxIntegerDigits: 17,
      fieldName: `${symbol}.priceChange24h`
    }),
    priceChangePercentage24h: sanitizeNumericValue(md?.price_change_percentage_24h, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage24h`
    }),
    priceChangePercentage7d: sanitizeNumericValue(md?.price_change_percentage_7d, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage7d`
    }),
    priceChangePercentage14d: sanitizeNumericValue(md?.price_change_percentage_14d, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage14d`
    }),
    priceChangePercentage30d: sanitizeNumericValue(md?.price_change_percentage_30d, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage30d`
    }),
    priceChangePercentage60d: sanitizeNumericValue(md?.price_change_percentage_60d, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage60d`
    }),
    priceChangePercentage200d: sanitizeNumericValue(md?.price_change_percentage_200d, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage200d`
    }),
    priceChangePercentage1y: sanitizeNumericValue(md?.price_change_percentage_1y, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.priceChangePercentage1y`
    }),
    marketCapChange24h: sanitizeNumericValue(md?.market_cap_change_24h, {
      fieldName: `${symbol}.marketCapChange24h`
    }),
    marketCapChangePercentage24h: sanitizeNumericValue(md?.market_cap_change_percentage_24h, {
      maxIntegerDigits: 5,
      fieldName: `${symbol}.marketCapChangePercentage24h`
    }),
    geckoLastUpdatedAt: md?.last_updated ?? null
  };
}
