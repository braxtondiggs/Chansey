import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { ChartData, ChartOptions } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { fromEvent } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { AccountValueDataPoint } from '@chansey/api-interfaces';

import { ExchangeBalanceService } from './exchange-balance.service';

import { SettingsService } from '../../../pages/user/settings/settings.service';
import { CounterDirective } from '../../directives/counter/counter.directive';
import { TimeAgoPipe } from '../../pipes/time-ago.pipe';
import { AuthService } from '../../services/auth.service';
import { LayoutService } from '../../services/layout.service';
import { createExternalChartTooltip } from '../../utils/chart-tooltip.util';

const CHART_CONFIG = {
  tension: 0.6,
  borderWidth: { desktop: 1.2, mobile: 2 },
  pointBorderWidth: 8,
  pointRadius: 4,
  mobileBreakpoint: 768,
  maxTicksLimit: { desktop: 10, mobile: 5 },
  maxRotation: { desktop: 0, mobile: 45 },
  fontSize: { desktop: 12, mobile: 10 },
  gridLineWidth: { desktop: 1.2, mobile: 0.8 },
  hoverRadius: { desktop: 6, mobile: 8 },
  hitRadius: { desktop: 20, mobile: 30 },
  decimationSamples: { desktop: 100, mobile: 50 },
  decimationThreshold: { desktop: 40, mobile: 20 },
  animationDuration: 400,
  largeDaysThreshold: 30,
  mediumDaysThreshold: 7
} as const;

@Component({
  selector: 'app-exchange-balance',
  imports: [
    ButtonModule,
    CardModule,
    ChartModule,
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    CounterDirective,
    FormsModule,
    ProgressSpinnerModule,
    SelectButtonModule,
    SkeletonModule,
    TagModule,
    TimeAgoPipe,
    TooltipModule
  ],
  templateUrl: './exchange-balance.component.html',
  styleUrls: ['./exchange-balance.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExchangeBalanceComponent {
  chartData: ChartData = { datasets: [] };
  chartOptions: ChartOptions = {};
  chartPlugins: any[] = [];
  // Track the current selected time period
  readonly currentDays = signal<number>(7);
  private readonly bgColor = signal<string[] | undefined>(undefined);
  private readonly borderColor = signal<string | undefined>(undefined);
  private readonly isDarkTheme = computed<boolean>(() => this.layoutService.isDarkTheme());
  private readonly isMobile = signal<boolean>(window.innerWidth < 768);
  private readonly destroyRef = inject(DestroyRef);
  private readonly layoutService = inject(LayoutService);
  private readonly authService = inject(AuthService);
  private readonly settingsService = inject(SettingsService);

  // Services
  private readonly balanceService = inject(ExchangeBalanceService);
  readonly lastUpdated = signal<Date | null>(null);

  // User and preferences
  readonly userQuery = this.authService.useUser();
  readonly updatePreferencesMutation = this.settingsService.useUpdateProfileMutation();
  readonly isBalanceHidden = computed(() => this.userQuery.data()?.hide_balance ?? false);

  private readonly balanceQuery = this.balanceService.useExchangeBalance();
  readonly balanceHistoryQuery = this.balanceService.useBalanceHistory(this.currentDays);
  readonly totalUsdValue = signal<number>(0);

  readonly timePeriods = signal([
    { label: '24H', value: 1 },
    { label: '1W', value: 7 },
    { label: '1M', value: 30 },
    { label: '1Y', value: 365 },
    { label: 'ALL', value: 0 }
  ]);

  // Periodic tick to force TimeAgoPipe re-evaluation (every 30s)
  readonly refreshTick = signal(0);
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Track when new data arrives (sets lastUpdated only on fresh data)
    effect(() => {
      const data = this.balanceHistoryQuery.data();
      if (data?.history?.length) {
        this.lastUpdated.set(new Date());
      }
    });

    // Consolidated chart rendering effect — reacts to data, theme, and breakpoint
    effect(() => {
      const data = this.balanceHistoryQuery.data();
      this.isDarkTheme(); // track theme changes
      this.isMobile(); // track breakpoint changes
      if (data?.history?.length) {
        this.setChart(data.history);
      }
    });

    // Resize listener — only updates isMobile signal (chart re-renders via effect above)
    fromEvent(window, 'resize')
      .pipe(debounceTime(250), takeUntilDestroyed())
      .subscribe(() => {
        const nowMobile = window.innerWidth < 768;
        if (nowMobile !== this.isMobile()) {
          this.isMobile.set(nowMobile);
        }
      });

    // Effect to update totalUsdValue signal when balanceQuery data changes
    effect(() => {
      const data = this.balanceQuery.data();
      if (data && typeof data.totalUsdValue === 'number') {
        this.totalUsdValue.set(data.totalUsdValue);
      }
    });

    // Visibility-aware periodic tick for TimeAgoPipe re-evaluation
    this.startTickInterval();
    fromEvent(document, 'visibilitychange')
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (document.hidden) {
          if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
          }
        } else {
          this.refreshTick.update((v) => v + 1);
          this.startTickInterval();
        }
      });
    this.destroyRef.onDestroy(() => {
      if (this.tickInterval) clearInterval(this.tickInterval);
    });
  }

  private startTickInterval() {
    this.tickInterval = setInterval(() => this.refreshTick.update((v) => v + 1), 30_000);
  }

  // Initialize chart
  private setChart(historyData: AccountValueDataPoint[]) {
    if (!historyData || historyData.length === 0) return;
    const rootStyles = getComputedStyle(document.documentElement);
    const surface400Color = rootStyles.getPropertyValue('--p-surface-400');
    const surface500Color = rootStyles.getPropertyValue('--p-surface-500');
    const surface200Color = rootStyles.getPropertyValue('--p-surface-200');
    const surface800Color = rootStyles.getPropertyValue('--p-surface-800');
    const surface0Color = rootStyles.getPropertyValue('--p-surface-0');
    const surface950Color = rootStyles.getPropertyValue('--p-surface-950');
    const endDate = historyData[historyData.length - 1].datetime;
    const startDate = historyData[0].datetime;

    const isMobile = this.isMobile();

    // Check if balance is hidden
    const balanceHidden = this.isBalanceHidden();

    // Determine appropriate time unit based on selected date range
    const timeUnit = this.getTimeUnit(this.currentDays());

    const days = this.currentDays();

    this.chartData = {
      datasets: [
        {
          label: 'Account Value (USD)',
          data: historyData.map((point) => ({
            x: new Date(point.datetime).getTime(),
            y: point.value
          })),
          fill: true,
          borderColor: this.borderColor() ?? (this.isDarkTheme() ? '#FAFAFA' : '#030616'),
          tension: CHART_CONFIG.tension,
          borderWidth: CHART_CONFIG.borderWidth.desktop,
          pointBorderColor: 'rgba(0, 0, 0, 0)',
          pointBackgroundColor: 'rgba(0, 0, 0, 0)',
          pointHoverBackgroundColor: this.borderColor() ?? (this.isDarkTheme() ? surface0Color : surface950Color),
          pointHoverBorderColor: this.isDarkTheme() ? surface950Color : surface0Color,
          pointBorderWidth: CHART_CONFIG.pointBorderWidth,
          pointStyle: 'circle',
          pointRadius: CHART_CONFIG.pointRadius,
          backgroundColor: (context: any) => {
            const defaultColor = [
              this.isDarkTheme() ? 'rgba(255, 255, 255, 0.24)' : 'rgba(3, 6, 22, 0.12)',
              this.isDarkTheme() ? 'rgba(255, 255, 255, 0)' : 'rgba(3, 6, 22, 0)'
            ];
            const bg = this.bgColor() ?? defaultColor;

            if (!context.chart.chartArea) {
              return;
            }

            const {
              ctx,
              chartArea: { top, bottom }
            } = context.chart;
            const gradientBg = ctx.createLinearGradient(0, top, 0, bottom);
            const colorTranches = 1 / (bg.length - 1);

            bg.forEach((color, index) => {
              gradientBg.addColorStop(index * colorTranches, color);
            });

            return gradientBg;
          }
        }
      ]
    };

    // Cache computed style values for the hover line plugin (avoid per-frame getComputedStyle)
    const hoverLineColor = this.borderColor() ?? (this.isDarkTheme() ? surface0Color : surface950Color);

    this.chartPlugins = [
      {
        id: 'hoverLine',
        afterDatasetsDraw: (chart: any) => {
          if (balanceHidden) return;

          const {
            ctx,
            tooltip,
            chartArea: { bottom },
            scales: { x, y }
          } = chart;
          if (tooltip?._active?.length > 0) {
            const xCoor = x.getPixelForValue(tooltip.dataPoints[0].raw.x);
            const yCoor = y.getPixelForValue(tooltip.dataPoints[0].parsed.y);
            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = CHART_CONFIG.borderWidth.desktop;
            ctx.strokeStyle = hoverLineColor;
            ctx.setLineDash([4, 2]);
            ctx.moveTo(xCoor, yCoor);
            ctx.lineTo(xCoor, bottom + 8);
            ctx.stroke();
            ctx.closePath();
            ctx.restore();
          }
        }
      }
    ];

    this.chartOptions = {
      maintainAspectRatio: false,
      responsive: true,
      interaction: balanceHidden
        ? { intersect: false, mode: 'none' as any }
        : { intersect: false, mode: 'index', axis: 'xy', includeInvisible: true },
      animation: {
        duration: isMobile ? 0 : days > CHART_CONFIG.largeDaysThreshold ? 0 : CHART_CONFIG.animationDuration
      },
      elements: {
        point: {
          radius: isMobile
            ? 0
            : days > CHART_CONFIG.largeDaysThreshold
              ? 0
              : days > CHART_CONFIG.mediumDaysThreshold
                ? 1
                : 2,
          hoverRadius: balanceHidden
            ? 0
            : isMobile
              ? CHART_CONFIG.hoverRadius.mobile
              : CHART_CONFIG.hoverRadius.desktop,
          hitRadius: balanceHidden ? 0 : isMobile ? CHART_CONFIG.hitRadius.mobile : CHART_CONFIG.hitRadius.desktop
        },
        line: {
          tension: CHART_CONFIG.tension,
          borderWidth: isMobile ? CHART_CONFIG.borderWidth.mobile : CHART_CONFIG.borderWidth.desktop
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: timeUnit,
            displayFormats: {
              hour: 'h:mm a',
              day: 'MMM d',
              week: 'MMM d',
              month: 'MMM yyyy',
              quarter: 'MMM yyyy'
            },
            tooltipFormat: 'MMM d yyyy, h:mm a'
          },
          ticks: {
            color: this.isDarkTheme() ? surface500Color : surface400Color,
            padding: 2,
            autoSkip: true,
            maxTicksLimit: isMobile ? CHART_CONFIG.maxTicksLimit.mobile : CHART_CONFIG.maxTicksLimit.desktop,
            maxRotation: isMobile ? CHART_CONFIG.maxRotation.mobile : CHART_CONFIG.maxRotation.desktop,
            source: 'auto',
            font: {
              size: isMobile ? CHART_CONFIG.fontSize.mobile : CHART_CONFIG.fontSize.desktop
            }
          },
          grid: {
            display: true,
            lineWidth: isMobile ? CHART_CONFIG.gridLineWidth.mobile : CHART_CONFIG.gridLineWidth.desktop,
            color: this.isDarkTheme() ? surface800Color : surface200Color
          },
          border: {
            display: false,
            dash: [4, 2]
          },
          min: new Date(startDate).valueOf(),
          max: new Date(endDate).valueOf()
        },
        y: {
          beginAtZero: false,
          display: false
        }
      },
      plugins: {
        tooltip: balanceHidden
          ? { enabled: false }
          : {
              enabled: false,
              position: 'nearest',
              external: createExternalChartTooltip({ mobileBreakpoint: CHART_CONFIG.mobileBreakpoint })
            },
        legend: { display: false },
        title: { display: false },
        decimation: {
          enabled: true,
          algorithm: 'lttb',
          samples: isMobile ? CHART_CONFIG.decimationSamples.mobile : CHART_CONFIG.decimationSamples.desktop,
          threshold: isMobile ? CHART_CONFIG.decimationThreshold.mobile : CHART_CONFIG.decimationThreshold.desktop
        }
      }
    };
  }

  // Determine appropriate time unit based on selected date range
  private getTimeUnit(
    days: number
  ): 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' {
    if (days === 0) return 'quarter';
    if (days <= 1) return 'hour';
    if (days <= 7) return 'day';
    if (days <= 30) return 'week';
    if (days <= 365) return 'month';
    return 'quarter';
  }

  // Toggle balance visibility
  toggleBalanceVisibility() {
    const currentHidden = this.isBalanceHidden();
    this.updatePreferencesMutation.mutate({
      hide_balance: !currentHidden
    });
  }
}
