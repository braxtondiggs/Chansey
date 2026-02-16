import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SkeletonModule } from 'primeng/skeleton';

import { AlgorithmPerformance, TimePeriod } from '@chansey/api-interfaces';

interface PeriodOption {
  label: string;
  value: TimePeriod;
}

@Component({
  selector: 'app-performance-chart',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ChartModule, SelectButtonModule, SkeletonModule],
  template: `
    <p-card>
      <ng-template #header>
        <div class="flex flex-col gap-4 p-4 pb-0 sm:flex-row sm:items-center sm:justify-between">
          <h3 class="m-0 text-lg font-semibold">Performance History</h3>
          <p-selectButton
            [options]="periodOptions"
            [(ngModel)]="selectedPeriod"
            (ngModelChange)="onPeriodChange($event)"
            optionLabel="label"
            optionValue="value"
            size="small"
          ></p-selectButton>
        </div>
      </ng-template>

      @if (isLoading) {
        <div class="space-y-4">
          <p-skeleton height="300px"></p-skeleton>
        </div>
      } @else if (performanceHistory && performanceHistory.length > 0) {
        <div class="h-80">
          <p-chart type="line" [data]="chartData" [options]="chartOptions" height="100%"></p-chart>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-4 border-t pt-4 md:grid-cols-4 dark:border-gray-700">
          <div>
            <label class="mb-1 block text-sm text-gray-500">Latest ROI</label>
            <span class="text-lg font-bold" [class]="getROIClass()">
              {{ formatPercent(latestPerformance?.roi) }}
            </span>
          </div>

          <div>
            <label class="mb-1 block text-sm text-gray-500">Win Rate</label>
            <span class="text-lg font-bold">{{ formatPercent(latestPerformance?.winRate) }}</span>
          </div>

          <div>
            <label class="mb-1 block text-sm text-gray-500">Sharpe Ratio</label>
            <span class="text-lg font-bold">{{ latestPerformance?.sharpeRatio?.toFixed(2) ?? '-' }}</span>
          </div>

          <div>
            <label class="mb-1 block text-sm text-gray-500">Max Drawdown</label>
            <span class="text-lg font-bold text-red-600">
              {{ latestPerformance?.maxDrawdown ? '-' + formatPercent(latestPerformance?.maxDrawdown) : '-' }}
            </span>
          </div>
        </div>
      } @else {
        <div class="py-12 text-center">
          <i class="pi pi-chart-line mb-3 text-4xl text-gray-400"></i>
          <p class="m-0 text-gray-500">No performance history available.</p>
          <p class="mt-1 text-sm text-gray-400">Performance data will appear after algorithm activations.</p>
        </div>
      }
    </p-card>
  `
})
export class PerformanceChartComponent implements OnChanges {
  @Input() performanceHistory?: AlgorithmPerformance[] | null;
  @Input() isLoading: boolean = false;
  @Input() selectedPeriod: TimePeriod = '7d';

  @Output() periodChange = new EventEmitter<TimePeriod>();

  chartData: any = {};
  chartOptions: any = {};

  periodOptions: PeriodOption[] = [
    { label: '24h', value: '24h' },
    { label: '7d', value: '7d' },
    { label: '30d', value: '30d' },
    { label: '1y', value: '1y' }
  ];

  get latestPerformance(): AlgorithmPerformance | undefined {
    if (!this.performanceHistory || this.performanceHistory.length === 0) return undefined;
    return this.performanceHistory[this.performanceHistory.length - 1];
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['performanceHistory'] && this.performanceHistory) {
      this.updateChart();
    }
  }

  onPeriodChange(period: TimePeriod): void {
    this.periodChange.emit(period);
  }

  getROIClass(): string {
    const roi = this.latestPerformance?.roi ?? 0;
    if (roi > 0) return 'text-green-600';
    if (roi < 0) return 'text-red-600';
    return '';
  }

  formatPercent(value?: number): string {
    if (value === undefined || value === null) return '-';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  }

  private updateChart(): void {
    if (!this.performanceHistory || this.performanceHistory.length === 0) {
      this.chartData = {};
      return;
    }

    const labels = this.performanceHistory.map((p) => this.formatChartDate(p.calculatedAt));
    const roiData = this.performanceHistory.map((p) => p.roi ?? 0);
    const winRateData = this.performanceHistory.map((p) => p.winRate ?? 0);

    this.chartData = {
      labels,
      datasets: [
        {
          label: 'ROI (%)',
          data: roiData,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          fill: true,
          tension: 0.4,
          yAxisID: 'y'
        },
        {
          label: 'Win Rate (%)',
          data: winRateData,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: false,
          tension: 0.4,
          yAxisID: 'y1'
        }
      ]
    };

    this.chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 20
          }
        },
        tooltip: {
          callbacks: {
            label: (context: any) => {
              const label = context.dataset.label || '';
              const value = context.parsed.y;
              return `${label}: ${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'ROI (%)'
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: 'Win Rate (%)'
          },
          min: 0,
          max: 100,
          grid: {
            drawOnChartArea: false
          }
        }
      }
    };
  }

  private formatChartDate(date: Date | string): string {
    const d = new Date(date);
    switch (this.selectedPeriod) {
      case '24h':
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      case '7d':
        return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      case '30d':
      case '1y':
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      default:
        return d.toLocaleDateString();
    }
  }
}
