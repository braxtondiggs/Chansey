import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from '@angular/core';

import { ChartData, ChartDataset, ChartOptions } from 'chart.js';
import { ChartModule } from 'primeng/chart';

import { MarketChartResponseDto, TimePeriod } from '@chansey/api-interfaces';

import { LayoutService } from '../../../shared/services/layout.service';
import { createExternalChartTooltip } from '../../../shared/utils/chart-tooltip.util';

/**
 * Displays historical price data as an interactive line chart.
 * Features:
 * - Chart.js line chart via PrimeNG wrapper
 * - Period selector tabs (24h, 7d, 30d, 1y)
 * - Responsive design
 * - Smooth line curves with area fill
 * - Auto-updating when chartData changes
 */
@Component({
  selector: 'app-price-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartModule],
  templateUrl: './price-chart.component.html',
  styleUrls: ['./price-chart.component.scss']
})
export class PriceChartComponent {
  private readonly layoutService = inject(LayoutService);
  private isDarkTheme = computed<boolean>(() => this.layoutService.isDarkTheme());

  chartData = input<MarketChartResponseDto | null>(null);
  isLoading = input(false);
  selectedPeriod = input<TimePeriod>('24h');
  periodChange = output<TimePeriod>();

  // Chart.js configuration & plugins
  chartType = 'line' as const;
  chartPlugins = [
    {
      id: 'hoverLine',
      afterDatasetsDraw: (chart: any) => {
        const {
          ctx,
          tooltip,
          chartArea: { bottom }
        } = chart;
        if (tooltip?._active?.length > 0) {
          const activePoint = tooltip.dataPoints[0];
          const xCoor = activePoint.element.x;
          const yCoor = activePoint.element.y;
          ctx.save();
          ctx.beginPath();
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = this.isDarkTheme() ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)';
          ctx.setLineDash([4, 2]);
          ctx.moveTo(xCoor, yCoor);
          ctx.lineTo(xCoor, bottom);
          ctx.stroke();
          ctx.closePath();
          ctx.restore();
        }
      }
    }
  ];
  data: ChartData<'line'> = {
    labels: [],
    datasets: []
  };
  options: ChartOptions<'line'> = this.createChartOptions();
  chartStyle = { width: '100%', height: 'clamp(300px, 62vw, 880px)' };

  // Period options for tabs
  periods: Array<{ label: string; value: TimePeriod }> = [
    { label: '24h', value: '24h' },
    { label: '7d', value: '7d' },
    { label: '30d', value: '30d' },
    { label: '1y', value: '1y' }
  ];

  constructor() {
    effect(() => {
      // Read signals to track them
      const data = this.chartData();
      const period = this.selectedPeriod();
      this.updateChart(data, period);
    });
  }

  /**
   * Handle period tab change
   */
  onPeriodChange(period: TimePeriod): void {
    this.periodChange.emit(period);
  }

  /**
   * Update chart data and configuration
   */
  private updateChart(chartData: MarketChartResponseDto | null | undefined, period: TimePeriod): void {
    if (!chartData || !chartData.prices || chartData.prices.length === 0) {
      const emptyDataset: ChartDataset<'line'> = {
        label: 'Price (USD)',
        data: [],
        fill: true,
        borderColor: 'rgba(148, 163, 184, 0.6)',
        backgroundColor: 'rgba(148, 163, 184, 0.15)',
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 0
      };
      this.data = {
        labels: [],
        datasets: [emptyDataset]
      };
      this.options = this.createChartOptions();
      return;
    }

    // Format timestamps to readable dates
    const labels = chartData.prices.map((point) => {
      const date = new Date(point.timestamp);
      if (period === '24h') {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (period === '7d') {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    });

    const prices = chartData.prices.map((point) => point.price);

    // Determine color based on first and last price
    const isPositive = prices.length > 1 && prices[prices.length - 1] >= prices[0];
    const lineColor = isPositive ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)'; // green-500 : red-500
    const fillColor = isPositive ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';

    const dataset: ChartDataset<'line'> = {
      label: 'Price (USD)',
      data: prices,
      fill: true,
      borderColor: lineColor,
      backgroundColor: fillColor,
      normalized: true,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: lineColor,
      pointHoverBorderColor: lineColor
    };

    this.data = {
      labels,
      datasets: [dataset]
    };

    this.options = this.createChartOptions();
  }

  private createChartOptions(): ChartOptions<'line'> {
    const gridColor = this.isDarkTheme() ? 'rgba(255, 255, 255, 0.1)' : 'rgba(200, 200, 200, 0.2)';
    const currentChartData = this.chartData();
    const currentPeriod = this.selectedPeriod();

    return {
      maintainAspectRatio: false,
      responsive: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: false,
          position: 'nearest',
          external: createExternalChartTooltip({ mobileBreakpoint: 768 }),
          callbacks: {
            title: (items: any[]) => {
              if (!items.length || !currentChartData?.prices) return '';
              const point = currentChartData.prices[items[0].dataIndex];
              if (!point) return items[0].label;
              const date = new Date(point.timestamp);
              if (currentPeriod === '24h') {
                return date.toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });
              }
              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            },
            label: (context: any) => {
              const parsed = context.parsed?.y ?? 0;
              return parsed.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              });
            }
          }
        },
        decimation: {
          enabled: true,
          algorithm: 'lttb',
          samples: 150
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            maxTicksLimit: 8,
            autoSkip: true
          }
        },
        y: {
          grid: {
            color: gridColor
          },
          ticks: {
            callback: (value) => {
              const numericValue = typeof value === 'number' ? value : Number(value);
              const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
              return '$' + safeValue.toLocaleString('en-US');
            }
          }
        }
      }
    };
  }
}
