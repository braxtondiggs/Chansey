import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, inject, signal, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, FormBuilder } from '@angular/forms';

import {
  Chart,
  ChartConfiguration,
  ChartData,
  ChartOptions,
  LinearScale,
  CategoryScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TagModule } from 'primeng/tag';

import { ExchangeKey } from '@chansey/api-interfaces';

import { ExchangeBalanceService, AccountValueDataPoint } from './exchange-balance.service';

@Component({
  selector: 'app-exchange-balance',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    ReactiveFormsModule,
    CardModule,
    ProgressSpinnerModule,
    TagModule,
    SelectButtonModule
  ],
  templateUrl: './exchange-balance.component.html'
})
export class ExchangeBalanceComponent implements AfterViewInit, OnDestroy {
  @Input() exchange!: ExchangeKey;
  @Input() refreshInterval: number = 60000; // Default refresh every minute
  @ViewChild('balanceChart') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private readonly fb = inject(FormBuilder);
  timePeriodForm: FormGroup = this.fb.group({
    value: new FormControl(1)
  });

  // Register Chart.js components
  constructor() {
    Chart.register(LinearScale, CategoryScale, PointElement, LineElement, Tooltip, Legend, Filler);
  }

  // Services
  private balanceService = inject(ExchangeBalanceService);
  balanceQuery = this.balanceService.useBalanceHistory(1); // Default to 24H (1 day)
  lastUpdated = signal<Date | null>(null);

  // Chart related properties
  chart: Chart | null = null;
  timePeriods = signal([
    { label: '24H', value: 1 },
    { label: '1W', value: 7 },
    { label: '1M', value: 30 },
    { label: '1Y', value: 365 },
    { label: 'ALL', value: 0 }
  ]);

  ngAfterViewInit() {
    this.initChart();
    this.updateChartFromQuery();
  }

  ngOnDestroy() {
    if (this.chart) {
      this.chart.destroy();
    }
  }

  // Update chart when data changes
  updateChartFromQuery() {
    const data = this.balanceQuery.data();
    if (data && data.history) {
      this.updateChart(data.history);
      this.lastUpdated.set(new Date());
    }
  }

  // Change time period and refetch data
  onPeriodChange(period: { label: string; value: number }) {
    const days = period.value;
    console.log('Selected period:', days);
    // Update selected period
    this.timePeriodForm.get('value')?.setValue(days);
    // Update the query
    this.balanceQuery = this.balanceService.useBalanceHistory(days);
    this.balanceQuery.refetch();

    // Update chart when data is available
    setTimeout(() => {
      this.updateChartFromQuery();
    }, 100);
  }

  // Initialize chart
  private initChart() {
    if (!this.chartCanvas) return;

    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const chartData: ChartData = {
      labels: [],
      datasets: [
        {
          label: 'Account Value (USD)',
          data: [],
          borderColor: '#3B82F6',
          backgroundColor: 'rgba(59, 130, 246, 0.2)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 2,
          pointHoverRadius: 5
        }
      ]
    };

    const chartOptions: ChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10
          }
        },
        y: {
          beginAtZero: false,
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            callback: (value) => {
              return '$' + this.formatNumber(value as number);
            }
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (context) => {
              return '$' + this.formatNumber(context.parsed.y);
            }
          }
        },
        legend: {
          display: false
        }
      }
    };

    const config: ChartConfiguration = {
      type: 'line',
      data: chartData,
      options: chartOptions
    };

    this.chart = new Chart(ctx, config);
  }

  // Update chart with new data
  private updateChart(historyData: AccountValueDataPoint[]) {
    if (!this.chart) return;

    const labels = historyData.map((item) => {
      const date = new Date(item.datetime);

      // Format date based on selected period
      const periodValue = this.timePeriodForm.get('value')?.value;
      if (periodValue <= 1) {
        // For 24H, show hour
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (periodValue <= 7) {
        // For 1W, show day and hour
        return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      } else if (periodValue <= 30) {
        // For 1M, show month and day
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      } else {
        // For 1Y and ALL, show month and year
        return date.toLocaleDateString([], { month: 'short', year: '2-digit' });
      }
    });

    const data = historyData.map((item) => item.value);

    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = data;
    this.chart.update();
  }

  // Format number with appropriate decimal places
  formatBalance(balance: number, asset: string): string {
    if (['BTC', 'ETH'].includes(asset)) {
      return balance.toFixed(6);
    } else {
      return balance.toFixed(2);
    }
  }

  // Format numbers for display in chart
  formatNumber(value: number): string {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(2) + 'M';
    } else if (value >= 1000) {
      return (value / 1000).toFixed(2) + 'K';
    } else {
      return value.toFixed(2);
    }
  }
}
