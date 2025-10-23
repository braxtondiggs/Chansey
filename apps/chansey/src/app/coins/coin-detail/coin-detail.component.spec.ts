import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { QueryClient } from '@tanstack/query-core';
import { of } from 'rxjs';

import { CoinDetailComponent } from './coin-detail.component';

/**
 * T011: CoinDetailComponent Tests (TDD)
 * Expected: These tests should FAIL because component doesn't exist yet
 */
describe('CoinDetailComponent - T011', () => {
  let component: CoinDetailComponent;
  let fixture: ComponentFixture<CoinDetailComponent>;

  const mockCoinDetail = {
    id: 'coin-uuid-123',
    slug: 'bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    imageUrl: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    currentPrice: 43250.5,
    priceChange24h: 1250.75,
    priceChange24hPercent: 2.98,
    marketCap: 845000000000,
    marketCapRank: 1,
    volume24h: 28500000000,
    circulatingSupply: 19500000,
    totalSupply: 21000000,
    maxSupply: 21000000,
    description:
      'Bitcoin is a decentralized cryptocurrency originally described in a 2008 whitepaper by Satoshi Nakamoto.',
    links: {
      homepage: ['https://bitcoin.org'],
      blockchainSite: ['https://blockchain.com', 'https://blockchair.com'],
      officialForumUrl: ['https://bitcointalk.org'],
      subredditUrl: 'https://reddit.com/r/bitcoin',
      repositoryUrl: ['https://github.com/bitcoin/bitcoin']
    },
    lastUpdated: new Date(),
    metadataLastUpdated: new Date()
  };

  const mockCoinDetailWithHoldings = {
    ...mockCoinDetail,
    userHoldings: {
      coinSymbol: 'BTC',
      totalAmount: 0.5,
      averageBuyPrice: 38000,
      currentValue: 21625.25,
      profitLoss: 2625.25,
      profitLossPercent: 13.82,
      exchanges: [
        { exchangeName: 'Binance', amount: 0.3, lastSynced: new Date('2024-01-01') },
        { exchangeName: 'Coinbase', amount: 0.2, lastSynced: new Date('2024-01-02') }
      ]
    }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, CoinDetailComponent],
      providers: [
        {
          provide: QueryClient,
          useFactory: () =>
            new QueryClient({
              defaultOptions: {
                queries: {
                  retry: false
                }
              }
            })
        },
        {
          provide: ActivatedRoute,
          useValue: {
            params: of({ slug: 'bitcoin' })
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CoinDetailComponent);
    component = fixture.componentInstance;
  });

  type CoinDetail = typeof mockCoinDetail;

  const render = (
    options: {
      detail?: Partial<CoinDetail>;
      isAuthenticated?: boolean;
      isLoading?: boolean;
      error?: string | null;
    } = {}
  ) => {
    if (options.isAuthenticated !== undefined) {
      component.isAuthenticated = options.isAuthenticated;
    }
    component.isLoading = options.isLoading ?? false;
    component.error = options.error ?? null;
    if (options.detail !== undefined) {
      const detail = { ...mockCoinDetail, ...options.detail } as CoinDetail;
      component.coinDetail = detail as any;
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Coin Info Section', () => {
    it('should render coin name', () => {
      const compiled = render({ detail: mockCoinDetail });
      const nameElement = compiled.querySelector('[data-testid="coin-name"]');

      expect(nameElement).toBeTruthy();
      expect(nameElement?.textContent).toContain('Bitcoin');
    });

    it('should render coin symbol', () => {
      const compiled = render({ detail: mockCoinDetail });
      const symbolElement = compiled.querySelector('[data-testid="coin-symbol"]');

      expect(symbolElement).toBeTruthy();
      expect(symbolElement?.textContent).toContain('BTC');
    });

    it('should render coin logo image', () => {
      const compiled = render({ detail: mockCoinDetail });
      const logoElement = compiled.querySelector('[data-testid="coin-logo"]') as HTMLImageElement;

      expect(logoElement).toBeTruthy();
      expect(logoElement?.src).toContain('bitcoin.png');
      expect(logoElement?.alt).toContain('Bitcoin');
    });

    it('should render current price', () => {
      const compiled = render({ detail: mockCoinDetail });
      const priceElement = compiled.querySelector('[data-testid="current-price"]');

      expect(priceElement).toBeTruthy();
      expect(priceElement?.textContent).toContain('43,250.50');
    });

    it('should render price change with positive styling', () => {
      const compiled = render({ detail: mockCoinDetail });
      const priceChangeElement = compiled.querySelector('[data-testid="price-change-24h"]');

      expect(priceChangeElement).toBeTruthy();
      expect(priceChangeElement?.textContent).toContain('2.98');
      expect(priceChangeElement?.classList.contains('text-green-500')).toBe(true);
    });

    it('should render price change with negative styling', () => {
      const coinWithNegativeChange = {
        ...mockCoinDetail,
        priceChange24hPercent: -2.98
      };

      const compiled = render({ detail: coinWithNegativeChange });
      const priceChangeElement = compiled.querySelector('[data-testid="price-change-24h"]');

      expect(priceChangeElement).toBeTruthy();
      expect(priceChangeElement?.classList.contains('text-red-500')).toBe(true);
    });
  });

  describe('Market Statistics Section', () => {
    beforeEach(() => {
      render({ detail: mockCoinDetail });
    });

    it('should display market cap', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const marketCapElement = compiled.querySelector('[data-testid="market-cap"]');

      expect(marketCapElement).toBeTruthy();
      expect(marketCapElement?.textContent).toContain('845');
    });

    it('should display market cap rank', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const rankElement = compiled.querySelector('[data-testid="market-cap-rank"]');

      expect(rankElement).toBeTruthy();
      expect(rankElement?.textContent).toContain('#1');
    });

    it('should display 24h volume', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const volumeElement = compiled.querySelector('[data-testid="volume-24h"]');

      expect(volumeElement).toBeTruthy();
      expect(volumeElement?.textContent).toContain('28.5');
    });

    it('should display circulating supply', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const circulatingElement = compiled.querySelector('[data-testid="circulating-supply"]');

      expect(circulatingElement).toBeTruthy();
      expect(circulatingElement?.textContent).toContain('19,500,000');
      expect(circulatingElement?.textContent).toContain('BTC');
    });

    it('should display total supply', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const totalElement = compiled.querySelector('[data-testid="total-supply"]');

      expect(totalElement).toBeTruthy();
      expect(totalElement?.textContent).toContain('21,000,000');
    });

    it('should display max supply', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const maxElement = compiled.querySelector('[data-testid="max-supply"]');

      expect(maxElement).toBeTruthy();
      expect(maxElement?.textContent).toContain('21,000,000');
    });

    it('should handle missing max supply', () => {
      const coinWithoutMaxSupply = {
        ...mockCoinDetail,
        maxSupply: undefined
      };

      const compiled = render({ detail: coinWithoutMaxSupply });
      const maxElement = compiled.querySelector('[data-testid="max-supply"]');

      expect(maxElement?.textContent).toContain('Unlimited');
    });
  });

  describe('Description Section', () => {
    it('should display coin description', () => {
      const compiled = render({ detail: mockCoinDetail });
      const descriptionElement = compiled.querySelector('[data-testid="coin-description"]');

      expect(descriptionElement).toBeTruthy();
      expect(descriptionElement?.textContent).toContain('Bitcoin is a decentralized cryptocurrency');
    });

    it('should handle empty description', () => {
      const coinWithoutDescription = {
        ...mockCoinDetail,
        description: ''
      };

      const compiled = render({ detail: coinWithoutDescription });
      const descriptionElement = compiled.querySelector('[data-testid="coin-description"]');

      expect(descriptionElement?.textContent).toContain('No description available');
    });
  });

  describe('External Links Section', () => {
    beforeEach(() => {
      render({ detail: mockCoinDetail });
    });

    it('should display homepage links', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const homepageLinks = compiled.querySelectorAll('[data-testid="link-homepage"]');

      expect(homepageLinks.length).toBeGreaterThan(0);
      expect(homepageLinks[0].getAttribute('href')).toBe('https://bitcoin.org');
    });

    it('should display blockchain explorer links', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const explorerLinks = compiled.querySelectorAll('[data-testid="link-blockchain"]');

      expect(explorerLinks.length).toBe(2);
      expect(explorerLinks[0].getAttribute('href')).toBe('https://blockchain.com');
      expect(explorerLinks[1].getAttribute('href')).toBe('https://blockchair.com');
    });

    it('should display subreddit link', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const subredditLink = compiled.querySelector('[data-testid="link-subreddit"]');

      expect(subredditLink).toBeTruthy();
      expect(subredditLink?.getAttribute('href')).toBe('https://reddit.com/r/bitcoin');
    });

    it('should display repository links', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const repoLinks = compiled.querySelectorAll('[data-testid="link-repository"]');

      expect(repoLinks.length).toBeGreaterThan(0);
      expect(repoLinks[0].getAttribute('href')).toBe('https://github.com/bitcoin/bitcoin');
    });

    it('should open external links in new tab', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const homepageLink = compiled.querySelector('[data-testid="link-homepage"]');

      expect(homepageLink?.getAttribute('target')).toBe('_blank');
      expect(homepageLink?.getAttribute('rel')).toContain('noopener');
    });
  });

  describe('User Holdings Section (Authenticated)', () => {
    it('should display holdings card for authenticated user', () => {
      const compiled = render({ detail: mockCoinDetailWithHoldings, isAuthenticated: true });
      const holdingsCard = compiled.querySelector('[data-testid="holdings-card"]');

      expect(holdingsCard).toBeTruthy();
    });

    it('should NOT display holdings card for unauthenticated user', () => {
      const compiled = render({ detail: mockCoinDetail, isAuthenticated: false });
      const holdingsCard = compiled.querySelector('[data-testid="holdings-card"]');

      expect(holdingsCard).toBeFalsy();
    });

    it('should display total holdings amount', () => {
      const compiled = render({ detail: mockCoinDetailWithHoldings, isAuthenticated: true });
      const totalAmountElement = compiled.querySelector('[data-testid="holdings-total-amount"]');

      expect(totalAmountElement).toBeTruthy();
      expect(totalAmountElement?.textContent).toContain('0.5');
      expect(totalAmountElement?.textContent).toContain('BTC');
    });

    it('should display current value', () => {
      const compiled = render({ detail: mockCoinDetailWithHoldings, isAuthenticated: true });
      const currentValueElement = compiled.querySelector('[data-testid="holdings-current-value"]');

      expect(currentValueElement).toBeTruthy();
      expect(currentValueElement?.textContent).toContain('21,625.25');
    });

    it('should display profit/loss with positive styling', () => {
      const compiled = render({ detail: mockCoinDetailWithHoldings, isAuthenticated: true });
      const profitLossElement = compiled.querySelector('[data-testid="holdings-profit-loss"]');

      expect(profitLossElement).toBeTruthy();
      expect(profitLossElement?.textContent).toContain('2,625.25');
      expect(profitLossElement?.classList.contains('text-green-500')).toBe(true);
    });

    it('should display profit/loss percentage', () => {
      const compiled = render({ detail: mockCoinDetailWithHoldings, isAuthenticated: true });
      const profitLossPercentElement = compiled.querySelector('[data-testid="holdings-profit-loss-percent"]');

      expect(profitLossPercentElement).toBeTruthy();
      expect(profitLossPercentElement?.textContent).toContain('13.82%');
    });

    it('should display average buy price', () => {
      const compiled = render({ detail: mockCoinDetailWithHoldings, isAuthenticated: true });
      const avgPriceElement = compiled.querySelector('[data-testid="holdings-avg-price"]');

      expect(avgPriceElement).toBeTruthy();
      expect(avgPriceElement?.textContent).toContain('38,000');
    });

    it('should display per-exchange breakdown', () => {
      const compiled = render({ detail: mockCoinDetailWithHoldings, isAuthenticated: true });
      const exchangeItems = compiled.querySelectorAll('[data-testid="holdings-exchange-item"]');

      expect(exchangeItems.length).toBe(2);

      const binanceItem = Array.from(exchangeItems).find((item) => item.textContent?.includes('Binance'));
      expect(binanceItem).toBeTruthy();
      expect(binanceItem?.textContent).toContain('0.3');

      const coinbaseItem = Array.from(exchangeItems).find((item) => item.textContent?.includes('Coinbase'));
      expect(coinbaseItem).toBeTruthy();
      expect(coinbaseItem?.textContent).toContain('0.2');
    });
  });

  describe('Loading and Error States', () => {
    it('should display loading skeleton when data is loading', () => {
      const compiled = render({ isLoading: true });
      const loadingSkeleton = compiled.querySelector('[data-testid="loading-skeleton"]');

      expect(loadingSkeleton).toBeTruthy();
    });

    it('should display error message on fetch error', () => {
      const compiled = render({ error: 'Failed to load coin details' });
      const errorElement = compiled.querySelector('[data-testid="error-message"]');

      expect(errorElement).toBeTruthy();
      expect(errorElement?.textContent).toContain('Failed to load coin details');
    });

    it('should hide content when loading', () => {
      const compiled = render({ isLoading: true, detail: mockCoinDetail });
      const contentElement = compiled.querySelector('[data-testid="coin-content"]');

      expect(contentElement).toBeFalsy();
    });
  });
});
