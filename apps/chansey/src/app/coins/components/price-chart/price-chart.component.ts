import { CommonModule } from '@angular/common';
import { Component, computed, EventEmitter, inject, Input, Output } from '@angular/core';

import { ChartData, ChartDataset, ChartOptions, TooltipItem } from 'chart.js';
import { ChartModule } from 'primeng/chart';

import { MarketChartResponseDto, TimePeriod } from '@chansey/api-interfaces';

import { LayoutService } from '../../../shared/services/layout.service';

/**
 * T025: PriceChartComponent
 *
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
  imports: [CommonModule, ChartModule],
  templateUrl: './price-chart.component.html',
  styleUrls: ['./price-chart.component.scss']
})
export class PriceChartComponent {
  private readonly layoutService = inject(LayoutService);
  private isDarkTheme = computed<boolean>(() => this.layoutService.isDarkTheme());
  private _chartData?: MarketChartResponseDto | null;
  private _lastPeriod?: TimePeriod;

  @Input()
  set chartData(value: MarketChartResponseDto | null | undefined) {
    this._chartData = value ?? null;
    this.updateChart();
  }

  get chartData(): MarketChartResponseDto | null | undefined {
    return this._chartData;
  }

  @Input() isLoading = false;
  @Input() selectedPeriod: TimePeriod = '24h';
  @Output() periodChange = new EventEmitter<TimePeriod>();

  // Chart.js configuration
  chartType = 'line' as const;
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

  /**
   * Handle period tab change
   */
  onPeriodChange(period: TimePeriod): void {
    this.selectedPeriod = period;
    this.periodChange.emit(period);
    this.updateChart();
  }

  /**
   * Update chart data and configuration
   */
  private updateChart(): void {
    const chartData = this._chartData;

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
      if (this.selectedPeriod === '24h') {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (this.selectedPeriod === '7d') {
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
      pointHoverRadius: 5
    };

    this.data = {
      labels,
      datasets: [dataset]
    };

    // Only recreate options when period or theme changes
    if (this._lastPeriod !== this.selectedPeriod) {
      this._lastPeriod = this.selectedPeriod;
      this.options = this.createChartOptions();
    }
  }

  private createChartOptions(): ChartOptions<'line'> {
    const gridColor = this.isDarkTheme() ? 'rgba(255, 255, 255, 0.1)' : 'rgba(200, 200, 200, 0.2)';

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
          enabled: true,
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context: TooltipItem<'line'>) => {
              const parsed = context.parsed?.y ?? 0;
              return `$${parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
