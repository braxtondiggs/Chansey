import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChartModule } from 'primeng/chart';

import { PriceChartComponent } from './price-chart.component';

/**
 * T012: PriceChartComponent Tests (TDD)
 * Expected: These tests should FAIL because component doesn't exist yet
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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Chart Rendering', () => {
    it('should render Chart.js line chart', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const chartElement = compiled.querySelector('p-chart');

      expect(chartElement).toBeTruthy();
    });

    it('should use line chart type', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.chartType).toBe('line');
    });

    it('should configure chart with correct data structure', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.data).toBeDefined();
      expect(component.data.labels).toBeDefined();
      expect(component.data.datasets).toBeDefined();
      expect(component.data.datasets.length).toBeGreaterThan(0);
    });

    it('should map timestamps to chart labels', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.data.labels?.length).toBe(mockChartData24h.timestamps.length);
    });

    it('should map prices to chart dataset', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      const dataset = component.data.datasets[0];
      expect(dataset.data.length).toBe(mockChartData24h.prices.length);
      expect(dataset.data[0]).toBe(mockChartData24h.prices[0].price);
    });

    it('should apply smooth line curve', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      const dataset = component.data.datasets[0];
      expect(dataset.tension).toBeGreaterThan(0); // Smooth curve
    });

    it('should fill area under line', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      const dataset = component.data.datasets[0];
      expect(dataset.fill).toBe(true);
    });
  });

  describe('Period Selection', () => {
    it('should default to 24h period', () => {
      expect(component.selectedPeriod).toBe('24h');
    });

    it('should render period selector tabs', () => {
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const periodTabs = compiled.querySelectorAll('[data-testid="period-tab"]');

      expect(periodTabs.length).toBe(4); // 24h, 7d, 30d, 1y
    });

    it('should display all four period options', () => {
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const tabs = Array.from(compiled.querySelectorAll('[data-testid="period-tab"]'));

      expect(tabs.some((tab) => tab.textContent?.includes('24h'))).toBe(true);
      expect(tabs.some((tab) => tab.textContent?.includes('7d'))).toBe(true);
      expect(tabs.some((tab) => tab.textContent?.includes('30d'))).toBe(true);
      expect(tabs.some((tab) => tab.textContent?.includes('1y'))).toBe(true);
    });

    it('should highlight selected period tab', () => {
      component.selectedPeriod = '24h';
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const selectedTab = compiled.querySelector('[data-testid="period-tab"][data-active="true"]');

      expect(selectedTab).toBeTruthy();
      expect(selectedTab?.textContent).toContain('24h');
    });

    it('should switch period when tab clicked', () => {
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const period7dTab = Array.from(compiled.querySelectorAll('[data-testid="period-tab"]')).find((tab) =>
        tab.textContent?.includes('7d')
      ) as HTMLElement;

      period7dTab?.click();
      fixture.detectChanges();

      expect(component.selectedPeriod).toBe('7d');
    });

    it('should emit periodChange event when period switched', () => {
      const periodChangeSpy = jest.spyOn(component.periodChange, 'emit');
      fixture.detectChanges();

      component.onPeriodChange('7d');

      expect(periodChangeSpy).toHaveBeenCalledWith('7d');
    });

    it('should update chart data when period changes', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      const initialDataLength = component.data.labels?.length;

      component.chartData = mockChartData7d;
      fixture.detectChanges();

      expect(component.data.labels?.length).not.toBe(initialDataLength);
    });
  });

  describe('Chart Options and Styling', () => {
    it('should configure responsive chart', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.options.responsive).toBe(true);
      expect(component.options.maintainAspectRatio).toBe(false);
    });

    it('should format x-axis with time labels', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.options.scales?.['x']).toBeDefined();
    });

    it('should format y-axis with currency', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.options.scales?.['y']).toBeDefined();
    });

    it('should show grid lines', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.options.scales?.['x']?.grid?.display).toBeDefined();
      expect(component.options.scales?.['y']?.grid?.display).toBeDefined();
    });

    it('should configure tooltip with price formatting', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.options.plugins?.tooltip).toBeDefined();
    });

    it('should hide legend', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.options.plugins?.legend?.display).toBe(false);
    });
  });

  describe('Empty and Missing Data', () => {
    it('should handle empty prices array gracefully', () => {
      const emptyData = {
        ...mockChartData24h,
        prices: [],
        timestamps: []
      };

      component.chartData = emptyData;
      fixture.detectChanges();

      expect(component.data.labels?.length).toBe(0);
      expect(component.data.datasets[0].data.length).toBe(0);
    });

    it('should display "No data available" message when empty', () => {
      const emptyData = {
        ...mockChartData24h,
        prices: [],
        timestamps: []
      };

      component.chartData = emptyData;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const noDataElement = compiled.querySelector('[data-testid="no-data-message"]');

      expect(noDataElement).toBeTruthy();
      expect(noDataElement?.textContent).toContain('No data available');
    });

    it('should hide chart when no data available', () => {
      const emptyData = {
        ...mockChartData24h,
        prices: [],
        timestamps: []
      };

      component.chartData = emptyData;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const chartElement = compiled.querySelector('p-chart');

      expect(chartElement).toBeFalsy();
    });

    it('should handle null chartData input', () => {
      component.chartData = null as any;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const noDataElement = compiled.querySelector('[data-testid="no-data-message"]');

      expect(noDataElement).toBeTruthy();
    });

    it('should handle undefined chartData input', () => {
      component.chartData = undefined as any;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const noDataElement = compiled.querySelector('[data-testid="no-data-message"]');

      expect(noDataElement).toBeTruthy();
    });
  });

  describe('Loading State', () => {
    it('should display loading spinner when isLoading is true', () => {
      component.isLoading = true;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const loadingElement = compiled.querySelector('[data-testid="chart-loading"]');

      expect(loadingElement).toBeTruthy();
    });

    it('should hide chart when loading', () => {
      component.isLoading = true;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const chartElement = compiled.querySelector('p-chart');

      expect(chartElement).toBeFalsy();
    });

    it('should show chart when loading completes', () => {
      component.isLoading = false;
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const chartElement = compiled.querySelector('p-chart');
      const loadingElement = compiled.querySelector('[data-testid="chart-loading"]');

      expect(chartElement).toBeTruthy();
      expect(loadingElement).toBeFalsy();
    });
  });

  describe('Chart Interactions', () => {
    it('should enable hover interactions', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.options.interaction?.mode).toBeDefined();
      expect(component.options.interaction?.intersect).toBe(false);
    });

    it('should show crosshair on hover', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      expect(component.options.interaction?.mode).toBe('index');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible chart container', () => {
      component.chartData = mockChartData24h;
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const chartContainer = compiled.querySelector('[role="img"]');

      expect(chartContainer).toBeTruthy();
    });

    it('should have aria-label for period tabs', () => {
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const periodTab = compiled.querySelector('[data-testid="period-tab"]');

      expect(periodTab?.getAttribute('aria-label')).toBeTruthy();
    });

    it('should indicate selected tab with aria-selected', () => {
      component.selectedPeriod = '24h';
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const selectedTab = compiled.querySelector('[data-testid="period-tab"][data-active="true"]');

      expect(selectedTab?.getAttribute('aria-selected')).toBe('true');
    });
  });
});
