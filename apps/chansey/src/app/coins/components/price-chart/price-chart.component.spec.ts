import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { ChartModule } from 'primeng/chart';

import { PriceChartComponent } from './price-chart.component';

/**
 * T012: PriceChartComponent Tests
 */
describe('PriceChartComponent - T012', () => {
  let component: PriceChartComponent;
  let fixture: ComponentFixture<PriceChartComponent>;

  const mockChartData24h = {
    coinSlug: 'bitcoin',
    period: '24h' as const,
    prices: [
      { timestamp: 1697846400000, price: 42000.5 },
      { timestamp: 1697850000000, price: 42100.25 },
      { timestamp: 1697853600000, price: 42250.75 },
      { timestamp: 1697857200000, price: 42150.0 },
      { timestamp: 1697860800000, price: 42300.5 }
    ],
    timestamps: [1697846400000, 1697850000000, 1697853600000, 1697857200000, 1697860800000],
    generatedAt: new Date()
  };

  const mockChartDataFalling = {
    coinSlug: 'bitcoin',
    period: '24h' as const,
    prices: [
      { timestamp: 1697846400000, price: 42300.5 },
      { timestamp: 1697850000000, price: 42100.25 },
      { timestamp: 1697853600000, price: 41800.0 }
    ],
    timestamps: [1697846400000, 1697850000000, 1697853600000],
    generatedAt: new Date()
  };

  const mockChartData7d = {
    coinSlug: 'bitcoin',
    period: '7d' as const,
    prices: Array.from({ length: 7 }, (_, i) => ({
      timestamp: Date.now() - (6 - i) * 24 * 60 * 60 * 1000,
      price: 40000 + Math.random() * 5000
    })),
    timestamps: Array.from({ length: 7 }, (_, i) => Date.now() - (6 - i) * 24 * 60 * 60 * 1000),
    generatedAt: new Date()
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PriceChartComponent, ChartModule]
    }).compileComponents();

    fixture = TestBed.createComponent(PriceChartComponent);
    component = fixture.componentInstance;
  });

  describe('Chart Rendering', () => {
    it('should render p-chart element when data is provided', () => {
      fixture.componentRef.setInput('chartData', mockChartData24h);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('p-chart')).toBeTruthy();
    });

    it('should map timestamps to labels and prices to dataset', () => {
      fixture.componentRef.setInput('chartData', mockChartData24h);
      fixture.detectChanges();

      expect(component.data.labels?.length).toBe(mockChartData24h.prices.length);
      const dataset = component.data.datasets[0];
      expect(dataset.data.length).toBe(mockChartData24h.prices.length);
      expect(dataset.data[0]).toBe(mockChartData24h.prices[0].price);
    });

    it('should use green color when price is rising', () => {
      fixture.componentRef.setInput('chartData', mockChartData24h);
      fixture.detectChanges();

      const dataset = component.data.datasets[0];
      expect(dataset.borderColor).toBe('rgb(34, 197, 94)');
      expect(dataset.backgroundColor).toBe('rgba(34, 197, 94, 0.1)');
    });

    it('should use red color when price is falling', () => {
      fixture.componentRef.setInput('chartData', mockChartDataFalling);
      fixture.detectChanges();

      const dataset = component.data.datasets[0];
      expect(dataset.borderColor).toBe('rgb(239, 68, 68)');
      expect(dataset.backgroundColor).toBe('rgba(239, 68, 68, 0.1)');
    });

    it('should format 24h labels as time and 7d labels as dates', () => {
      fixture.componentRef.setInput('chartData', mockChartData24h);
      fixture.detectChanges();
      const label24h = component.data.labels?.[0] as string;
      // 24h labels should be time format (e.g., "10:00 AM")
      expect(label24h).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);

      fixture.componentRef.setInput('chartData', mockChartData7d);
      fixture.componentRef.setInput('selectedPeriod', '7d');
      fixture.detectChanges();
      const label7d = component.data.labels?.[0] as string;
      // 7d labels should be date format (e.g., "Mar 8")
      expect(label7d).toMatch(/[A-Z][a-z]{2}\s\d{1,2}/);
    });
  });

  describe('Period Selection', () => {
    it('should default to 24h period', () => {
      expect(component.selectedPeriod()).toBe('24h');
    });

    it('should display all four period options (24h, 7d, 30d, 1y)', () => {
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const tabs = Array.from(compiled.querySelectorAll('[data-testid="period-tab"]'));

      expect(tabs.length).toBe(4);
      expect(tabs.some((tab) => tab.textContent?.includes('24h'))).toBe(true);
      expect(tabs.some((tab) => tab.textContent?.includes('7d'))).toBe(true);
      expect(tabs.some((tab) => tab.textContent?.includes('30d'))).toBe(true);
      expect(tabs.some((tab) => tab.textContent?.includes('1y'))).toBe(true);
    });

    it('should highlight selected period tab with active and aria-selected attributes', () => {
      fixture.componentRef.setInput('selectedPeriod', '24h');
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const selectedTab = compiled.querySelector('[data-testid="period-tab"][data-active="true"]');

      expect(selectedTab).toBeTruthy();
      expect(selectedTab?.textContent).toContain('24h');
      expect(selectedTab?.getAttribute('aria-selected')).toBe('true');
    });

    it('should emit periodChange event when period switched', () => {
      fixture.detectChanges();

      const emitted: string[] = [];
      component.periodChange.subscribe((val: string) => emitted.push(val));

      component.onPeriodChange('7d');

      expect(emitted).toEqual(['7d']);
    });

    it('should update chart data when chartData input changes', () => {
      fixture.componentRef.setInput('chartData', mockChartData24h);
      fixture.detectChanges();

      const initialDataLength = component.data.labels?.length;

      fixture.componentRef.setInput('chartData', mockChartData7d);
      fixture.detectChanges();

      expect(component.data.labels?.length).not.toBe(initialDataLength);
    });
  });

  describe('Chart Options', () => {
    it('should hide legend', () => {
      fixture.componentRef.setInput('chartData', mockChartData24h);
      fixture.detectChanges();

      expect(component.options.plugins?.legend?.display).toBe(false);
    });

    it('should configure index interaction mode without intersect', () => {
      fixture.componentRef.setInput('chartData', mockChartData24h);
      fixture.detectChanges();

      expect(component.options.interaction?.mode).toBe('index');
      expect(component.options.interaction?.intersect).toBe(false);
    });

    it('should format y-axis ticks as USD currency', () => {
      fixture.componentRef.setInput('chartData', mockChartData24h);
      fixture.detectChanges();

      const callback = component.options.scales?.['y']?.ticks?.callback;
      expect(callback).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      const formatted = (callback as Function)(42000, 0, []);
      expect(formatted).toBe('$42,000');
    });
  });

  describe('Empty and Missing Data', () => {
    it('should show no-data message and hide chart when prices are empty', () => {
      const emptyData = {
        ...mockChartData24h,
        prices: [],
        timestamps: []
      };

      fixture.componentRef.setInput('chartData', emptyData);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('[data-testid="no-data-message"]')).toBeTruthy();
      expect(compiled.querySelector('p-chart')).toBeFalsy();
      expect(component.data.labels?.length).toBe(0);
      expect(component.data.datasets[0].data.length).toBe(0);
    });

    it('should show no-data message when chartData is null', () => {
      fixture.componentRef.setInput('chartData', null);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('[data-testid="no-data-message"]')).toBeTruthy();
    });
  });

  describe('Loading State', () => {
    it('should display loading spinner and hide chart when isLoading is true', () => {
      fixture.componentRef.setInput('isLoading', true);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('[data-testid="chart-loading"]')).toBeTruthy();
      expect(compiled.querySelector('p-chart')).toBeFalsy();
    });

    it('should show chart when loading completes with data', () => {
      fixture.componentRef.setInput('isLoading', false);
      fixture.componentRef.setInput('chartData', mockChartData24h);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('p-chart')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="chart-loading"]')).toBeFalsy();
    });
  });

  describe('Accessibility', () => {
    it('should have role="img" on chart container with aria-label', () => {
      fixture.componentRef.setInput('chartData', mockChartData24h);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const chartContainer = compiled.querySelector('[role="img"]');
      expect(chartContainer).toBeTruthy();
      expect(chartContainer?.getAttribute('aria-label')).toContain('24h');
    });

    it('should have aria-label for period tabs', () => {
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const periodTab = compiled.querySelector('[data-testid="period-tab"]');
      expect(periodTab?.getAttribute('aria-label')).toBeTruthy();
    });
  });
});
