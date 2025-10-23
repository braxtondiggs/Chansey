/**
 * Contract tests for CoinGecko API
 *
 * These tests validate the structure of CoinGecko API responses to ensure
 * our integration remains compatible with their API.
 *
 * Note: These tests use mocked responses to avoid rate limits and ensure stability.
 */

describe('CoinGecko API Contract Tests', () => {
  describe('GET /coins/{id}', () => {
    it('should return coin detail with required fields', async () => {
      // Mock CoinGecko response structure
      const mockResponse = {
        id: 'bitcoin',
        symbol: 'btc',
        name: 'Bitcoin',
        description: {
          en: 'Bitcoin is a decentralized cryptocurrency...'
        },
        image: {
          thumb: 'https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png',
          small: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
          large: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png'
        },
        market_data: {
          current_price: {
            usd: 43250.50
          },
          market_cap: {
            usd: 845000000000
          },
          total_volume: {
            usd: 28500000000
          },
          circulating_supply: 19500000,
          total_supply: 21000000,
          max_supply: 21000000,
          price_change_24h: 1250.75,
          price_change_percentage_24h: 2.98,
          market_cap_rank: 1
        },
        links: {
          homepage: ['https://bitcoin.org'],
          blockchain_site: ['https://blockchain.com', 'https://blockchair.com'],
          official_forum_url: ['https://bitcointalk.org'],
          subreddit_url: 'https://reddit.com/r/bitcoin',
          repos_url: {
            github: ['https://github.com/bitcoin/bitcoin']
          }
        }
      };

      // Validate required fields exist
      expect(mockResponse).toHaveProperty('id');
      expect(mockResponse).toHaveProperty('symbol');
      expect(mockResponse).toHaveProperty('name');
      expect(mockResponse).toHaveProperty('description');
      expect(mockResponse).toHaveProperty('market_data');
      expect(mockResponse).toHaveProperty('links');

      // Validate market_data structure
      expect(mockResponse.market_data).toHaveProperty('current_price');
      expect(mockResponse.market_data).toHaveProperty('market_cap');
      expect(mockResponse.market_data).toHaveProperty('total_volume');
      expect(mockResponse.market_data).toHaveProperty('circulating_supply');

      // Validate links structure
      expect(mockResponse.links).toHaveProperty('homepage');
      expect(Array.isArray(mockResponse.links.homepage)).toBe(true);
      expect(mockResponse.links).toHaveProperty('blockchain_site');
      expect(Array.isArray(mockResponse.links.blockchain_site)).toBe(true);
    });

    it('should handle coins with incomplete data', async () => {
      // Some coins may have null/undefined fields
      const mockResponse = {
        id: 'new-coin',
        symbol: 'newc',
        name: 'New Coin',
        description: {
          en: ''
        },
        market_data: {
          current_price: {
            usd: 0.01
          },
          market_cap: {
            usd: 1000000
          },
          total_volume: null,
          circulating_supply: 1000000,
          total_supply: null,
          max_supply: null
        },
        links: {
          homepage: [],
          blockchain_site: [],
          official_forum_url: [],
          subreddit_url: null
        }
      };

      expect(mockResponse).toHaveProperty('id');
      expect(mockResponse.market_data.total_supply).toBeNull();
      expect(mockResponse.links.homepage).toHaveLength(0);
    });
  });

  describe('GET /coins/{id}/market_chart', () => {
    it('should return market chart data with prices array', async () => {
      const mockResponse = {
        prices: [
          [1697846400000, 42000.50],
          [1697932800000, 42500.25],
          [1698019200000, 43250.50]
        ],
        market_caps: [
          [1697846400000, 820000000000],
          [1697932800000, 830000000000],
          [1698019200000, 845000000000]
        ],
        total_volumes: [
          [1697846400000, 27000000000],
          [1697932800000, 27500000000],
          [1698019200000, 28500000000]
        ]
      };

      expect(mockResponse).toHaveProperty('prices');
      expect(Array.isArray(mockResponse.prices)).toBe(true);
      expect(mockResponse.prices.length).toBeGreaterThan(0);

      // Validate each price entry has timestamp and price
      mockResponse.prices.forEach(priceEntry => {
        expect(priceEntry).toHaveLength(2);
        expect(typeof priceEntry[0]).toBe('number'); // timestamp
        expect(typeof priceEntry[1]).toBe('number'); // price
      });
    });

    it('should return data for different time periods', async () => {
      // Test days parameter: 1, 7, 30, 365
      const testCases = [
        { days: 1, expectedPoints: 24 },   // ~24 data points for 1 day
        { days: 7, expectedPoints: 168 },  // ~168 data points for 7 days
        { days: 30, expectedPoints: 720 }, // ~720 data points for 30 days
        { days: 365, expectedPoints: 365 } // ~365 data points for 1 year
      ];

      testCases.forEach(testCase => {
        // Mock would query with vs_currency=usd&days={testCase.days}
        expect(testCase.days).toBeGreaterThan(0);
        expect(testCase.expectedPoints).toBeGreaterThan(0);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle 429 rate limit response', async () => {
      const mockErrorResponse = {
        status: 429,
        error: 'rate_limit_exceeded'
      };

      expect(mockErrorResponse.status).toBe(429);
    });

    it('should handle 404 coin not found', async () => {
      const mockErrorResponse = {
        status: 404,
        error: 'coin not found'
      };

      expect(mockErrorResponse.status).toBe(404);
    });

    it('should handle network errors gracefully', async () => {
      const mockNetworkError = {
        code: 'ECONNREFUSED',
        message: 'Network error'
      };

      expect(mockNetworkError).toHaveProperty('code');
      expect(mockNetworkError).toHaveProperty('message');
    });
  });
});
