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

import { buildBalanceChartConfig } from './chart-config.util';
import { ExchangeBalanceService } from './exchange-balance.service';

import { SettingsService } from '../../../pages/user/settings/settings.service';
import { CounterDirective } from '../../directives/counter/counter.directive';
import { TimeAgoPipe } from '../../pipes/time-ago.pipe';
import { AuthService } from '../../services/auth.service';
import { LayoutService } from '../../services/layout.service';

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
        const result = buildBalanceChartConfig(data.history, {
          isDarkTheme: this.isDarkTheme(),
          isMobile: this.isMobile(),
          isBalanceHidden: this.isBalanceHidden(),
          currentDays: this.currentDays(),
          bgColor: this.bgColor(),
          borderColor: this.borderColor()
        });
        this.chartData = result.chartData;
        this.chartOptions = result.chartOptions;
        this.chartPlugins = result.chartPlugins;
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

  // Toggle balance visibility
  toggleBalanceVisibility() {
    const currentHidden = this.isBalanceHidden();
    this.updatePreferencesMutation.mutate({
      hide_balance: !currentHidden
    });
  }
}
