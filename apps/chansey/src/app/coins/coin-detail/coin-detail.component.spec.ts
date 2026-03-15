import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QueryClient } from '@tanstack/query-core';

import { CoinDetailComponent } from './coin-detail.component';

describe('CoinDetailComponent - T011', () => {
  let component: CoinDetailComponent;
  let fixture: ComponentFixture<CoinDetailComponent>;

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
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CoinDetailComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('slug', 'bitcoin');
  });

  describe('Period management', () => {
    it('should default selectedPeriod to 24h', () => {
      expect(component.selectedPeriod()).toBe('24h');
    });

    it('should update selectedPeriod on onPeriodChange', () => {
      component.onPeriodChange('7d');
      expect(component.selectedPeriod()).toBe('7d');

      component.onPeriodChange('30d');
      expect(component.selectedPeriod()).toBe('30d');
    });
  });

  describe('Description toggle', () => {
    it('should toggle descriptionExpanded between false and true', () => {
      expect(component.descriptionExpanded()).toBe(false);
      component.toggleDescription();
      expect(component.descriptionExpanded()).toBe(true);
      component.toggleDescription();
      expect(component.descriptionExpanded()).toBe(false);
    });
  });

  describe('formatPrice', () => {
    it('should format numeric values as USD currency', () => {
      expect(component.formatPrice(43250.5)).toContain('43,250.50');
      expect(component.formatPrice(0.005)).toContain('0.01');
    });

    it('should format zero as a valid price', () => {
      const result = component.formatPrice(0);
      expect(result).toContain('0.00');
      expect(result).not.toBe('—');
    });

    it('should return em-dash for null or undefined', () => {
      expect(component.formatPrice(null)).toBe('—');
      expect(component.formatPrice(undefined)).toBe('—');
    });
  });

  describe('Computed signals (no data loaded)', () => {
    it('should return fallback values when no coin detail is loaded', () => {
      expect(component.formattedPriceChange()).toBe('0.00%');
      expect(component.priceChangeClass()).toBe('');
      expect(component.athChangeText()).toBe('');
      expect(component.is404()).toBe(false);
    });
  });
});
