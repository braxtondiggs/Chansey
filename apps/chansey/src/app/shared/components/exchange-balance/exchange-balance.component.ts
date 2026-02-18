import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, computed, effect, inject, Input, OnDestroy, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

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

import { AccountValueDataPoint, ExchangeKey } from '@chansey/api-interfaces';

import { ExchangeBalanceService } from './exchange-balance.service';

import { ProfileService } from '../../../pages/user/profile/profile.service';
import { CounterDirective } from '../../directives/counter/counter.directive';
import { AuthService } from '../../services/auth.service';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-exchange-balance',
  standalone: true,
  imports: [
    ButtonModule,
    CardModule,
    ChartModule,
    CommonModule,
    CounterDirective,
    ProgressSpinnerModule,
    ReactiveFormsModule,
    SelectButtonModule,
    SkeletonModule,
    TagModule,
    TooltipModule
  ],
  templateUrl: './exchange-balance.component.html',
  styleUrls: ['./exchange-balance.component.css']
})
export class ExchangeBalanceComponent implements AfterViewInit, OnDestroy {
  @Input() exchange!: ExchangeKey;

  chartData!: ChartData;
  chartOptions!: ChartOptions;
  chartPlugins!: any[];
  // Track the current selected time period
  currentDays = signal<number>(7);
  bgColor = signal<string[] | undefined>(undefined);
  borderColor = signal<string | undefined>(undefined);
  isDarkTheme = computed<boolean>(() => this.layoutService.isDarkTheme());
  private readonly fb = inject(FormBuilder);
  private readonly layoutService = inject(LayoutService);
  private readonly authService = inject(AuthService);
  private readonly profileService = inject(ProfileService);

  timePeriodForm: FormGroup = this.fb.group({
    value: new FormControl(this.currentDays())
  });

  // Services
  balanceService = inject(ExchangeBalanceService);
  lastUpdated = signal<Date | null>(null);

  // User and preferences
  userQuery = this.authService.useUser();
  updatePreferencesMutation = this.profileService.useUpdateProfileMutation();
  isBalanceHidden = computed(() => this.userQuery.data()?.hide_balance ?? false);

  balanceQuery = this.balanceService.useExchangeBalance();
  balanceHistoryQuery = this.balanceService.useBalanceHistory(this.currentDays);
  totalUsdValue = signal<number>(0);

  timePeriods = signal([
    { label: '24H', value: 1 },
    { label: '1W', value: 7 },
    { label: '1M', value: 30 },
    { label: '1Y', value: 365 },
    { label: 'ALL', value: 0 }
  ]);

  constructor() {
    // Effect that watches for changes in balance history data (for chart only)
    effect(() => {
      // This effect will re-run whenever balanceHistoryQuery.data() changes
      const data = this.balanceHistoryQuery.data();

      if (data) {
        const historyData = data.history || [];
        this.setChart(historyData);
        this.lastUpdated.set(new Date());
      }
    });

    // Add resize listener to update chart when window size changes
    window.addEventListener('resize', this.handleResize);

    // Effect to update totalUsdValue signal when balanceQuery data changes
    effect(() => {
      const data = this.balanceQuery.data();
      if (data && typeof data.totalUsdValue === 'number') {
        this.totalUsdValue.set(data.totalUsdValue);
      }
    });
  }

  ngAfterViewInit() {
    this.timePeriodForm.get('value')?.valueChanges.subscribe((value: number) => {
      this.currentDays.set(value);
    });
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

    // Determine if we're on a mobile device
    const isMobile = window.innerWidth < 768;

    // Check if balance is hidden
    const balanceHidden = this.isBalanceHidden();

    // Determine appropriate time unit based on selected date range
    const timeUnit = this.getTimeUnit(this.currentDays());

    this.chartData = {
      datasets: [
        {
          label: 'Account Value (USD)',
          data: historyData.map((point) => {
            return {
              x: new Date(point.datetime), // Use Date object directly
              y: point.value
            };
          }) as any,
          fill: true,
          borderColor: this.borderColor() ?? (this.isDarkTheme() ? '#FAFAFA' : '#030616'),
          tension: 0.6, // Increased from 0.3 to 0.6 for smoother curves
          borderWidth: 1.2,
          pointBorderColor: 'rgba(0, 0, 0, 0)',
          pointBackgroundColor: 'rgba(0, 0, 0, 0)',
          pointHoverBackgroundColor: this.borderColor() ?? (this.isDarkTheme() ? surface0Color : surface950Color),
          pointHoverBorderColor: this.isDarkTheme() ? surface950Color : surface0Color,
          pointBorderWidth: 8,
          pointStyle: 'circle',
          pointRadius: 4,
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

    this.chartPlugins = [
      {
        id: 'hoverLine',
        afterDatasetsDraw: (chart: any) => {
          // Don't draw hover line if balance is hidden
          if (balanceHidden) return;

          const {
            ctx,
            tooltip,
            chartArea: { bottom },
            scales: { x, y }
          } = chart;
          if (tooltip._active.length > 0) {
            const xCoor = x.getPixelForValue(tooltip.dataPoints[0].raw.x);
            const yCoor = y.getPixelForValue(tooltip.dataPoints[0].parsed.y);
            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = 1.2;
            const rootStyles = getComputedStyle(document.documentElement);
            const surface0Color = rootStyles.getPropertyValue('--p-surface-0');
            const surface950Color = rootStyles.getPropertyValue('--p-surface-950');
            ctx.strokeStyle = this.borderColor() ?? (this.isDarkTheme() ? surface0Color : surface950Color);
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
      aspectRatio: 1,
      interaction: balanceHidden
        ? {
            intersect: false,
            mode: 'none' as any // Disable all interactions when balance is hidden
          }
        : {
            intersect: false,
            mode: 'index',
            axis: 'xy', // Better cross-axis tracking for mobile touch
            includeInvisible: true // Consider invisible points on mobile scrolling
          },
      animation: {
        duration: isMobile ? 0 : this.currentDays() > 30 ? 0 : 400 // Disable animation on mobile for better performance
      },
      elements: {
        point: {
          radius: isMobile ? 0 : this.currentDays() > 30 ? 0 : this.currentDays() > 7 ? 1 : 2, // Hide points on mobile
          hoverRadius: balanceHidden ? 0 : isMobile ? 8 : 6, // Disable hover when balance is hidden
          hitRadius: balanceHidden ? 0 : isMobile ? 30 : 20 // Disable hit area when balance is hidden
        },
        line: {
          tension: 0.6,
          borderWidth: isMobile ? 2 : 1.2 // Thicker line on mobile for better visibility
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
            maxTicksLimit: window.innerWidth < 768 ? 5 : 10, // Fewer ticks on mobile
            maxRotation: window.innerWidth < 768 ? 45 : 0, // Allow slight rotation on mobile
            source: 'auto',
            font: {
              size: window.innerWidth < 768 ? 10 : 12 // Smaller font on mobile
            }
          },
          grid: {
            display: true,
            lineWidth: window.innerWidth < 768 ? 0.8 : 1.2, // Thinner grid lines on mobile
            color: this.isDarkTheme() ? surface800Color : surface200Color
          },
          border: {
            display: false,
            dash: [4, 2]
          },
          // Use Date objects directly
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
          ? {
              enabled: false // Completely disable tooltip when balance is hidden
            }
          : {
              enabled: false,
              position: 'nearest',
              external: function (context: any) {
                const { chart, tooltip } = context;
                let tooltipEl = chart.canvas.parentNode.querySelector('div.chartjs-tooltip');
                if (!tooltipEl) {
                  tooltipEl = document.createElement('div');
                  tooltipEl.classList.add(
                    'chartjs-tooltip',
                    'label-small',
                    'px-2',
                    'py-1',
                    'dark:bg-surface-950',
                    'bg-surface-0',
                    'rounded-[8px]',
                    'opacity-100',
                    'flex',
                    'items-center',
                    'justify-center',
                    'border',
                    'border-surface',
                    'pointer-events-none',
                    'absolute',
                    '-translate-x-1/2',
                    'transition-all',
                    'duration-[0.05s]',
                    'shadow-[0px_1px_2px_0px_rgba(18,18,23,0.05)]'
                  );
                  chart.canvas.parentNode.appendChild(tooltipEl);
                }

                if (tooltip.opacity === 0) {
                  tooltipEl.style.opacity = 0;
                  return;
                }

                if (tooltip.body) {
                  const bodyLines = tooltip.body.map((b: any) => {
                    const strArr = b.lines[0].split(':');
                    return {
                      text: strArr[0].trim(),
                      title: tooltip.title[0].trim(),
                      value: strArr[1].trim()
                    };
                  });

                  tooltipEl.innerHTML = '';
                  bodyLines.forEach((body: any) => {
                    const text = document.createElement('div');
                    const isMobileView = window.innerWidth < 768;
                    text.appendChild(document.createTextNode(`${body.title} $${body.value}`));
                    text.classList.add('label-small', 'text-surface-950', 'dark:text-surface-0', 'font-medium');
                    // Larger font size on mobile for better readability
                    text.style.fontSize = isMobileView ? '16px' : '14px';
                    text.style.padding = isMobileView ? '4px 2px' : '0px';
                    tooltipEl.appendChild(text);
                  });
                }

                const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;
                const isMobileView = window.innerWidth < 768;

                tooltipEl.style.opacity = 1;

                // Adjust tooltip position for mobile devices
                if (isMobileView) {
                  // On mobile, position tooltip centered horizontally for better visibility
                  tooltipEl.style.left = positionX + chart.width / 2 + 'px';
                  tooltipEl.style.top = positionY + 20 + 'px'; // Position near the top for visibility
                  tooltipEl.style.transform = 'translateX(-50%)';
                  tooltipEl.style.padding = '8px 12px';
                  tooltipEl.style.fontSize = '16px'; // Larger font for mobile
                } else {
                  // Standard positioning on desktop
                  tooltipEl.style.left = positionX + tooltip.caretX + 'px';
                  tooltipEl.style.top = positionY + tooltip.caretY - 45 + 'px';
                }
              }
            },
        legend: {
          display: false
        },
        title: {
          display: false
        },
        decimation: {
          enabled: true,
          algorithm: 'lttb',
          samples: isMobile ? 50 : 100, // Fewer samples on mobile
          threshold: isMobile ? 20 : 40 // Lower threshold on mobile for better performance
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

  // Handle resize events to redraw the chart for responsiveness
  private readonly handleResize = () => {
    const data = this.balanceHistoryQuery.data();
    if (data && data.history) {
      this.setChart(data.history);
    }
  };

  // Cleanup event listener when component is destroyed
  ngOnDestroy() {
    window.removeEventListener('resize', this.handleResize);
  }

  // Toggle balance visibility
  toggleBalanceVisibility() {
    const currentHidden = this.isBalanceHidden();
    this.updatePreferencesMutation.mutate({
      hide_balance: !currentHidden
    });
  }
}
