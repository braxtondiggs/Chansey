import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';

import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { ExchangeBalanceComponent } from '../../shared/components/exchange-balance/exchange-balance.component';
import { ExchangeStatusAlertComponent } from '../../shared/components/exchange-status-alert/exchange-status-alert.component';
import { GettingStartedComponent } from '../../shared/components/getting-started/getting-started.component';
import { RecentTransactionsComponent } from '../../shared/components/recent-transactions/recent-transactions.component';
import { StrategyStatusCardComponent } from '../../shared/components/strategy-status-card/strategy-status-card.component';
import { UserAssetsComponent } from '../../shared/components/user-assets/user-assets.component';
import { AuthService } from '../../shared/services/auth.service';
import { LayoutService } from '../../shared/services/layout.service';

@Component({
  selector: 'app-dashboard',
  imports: [
    ProgressSpinnerModule,
    ExchangeBalanceComponent,
    ExchangeStatusAlertComponent,
    GettingStartedComponent,
    StrategyStatusCardComponent,
    UserAssetsComponent,
    RecentTransactionsComponent
  ],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
  private readonly authService = inject(AuthService);
  private readonly layoutService = inject(LayoutService);
  private readonly destroyRef = inject(DestroyRef);
  readonly userQuery = this.authService.useUser();

  showWizard = signal(false);
  private dismissedByUser = false;

  private needsOnboarding = computed(() => {
    const user = this.userQuery.data();
    if (!user) return false;
    return (user.exchanges ?? []).length === 0 || !user.coinRisk;
  });

  constructor() {
    effect(() => {
      const needs = this.needsOnboarding();
      if (needs && !this.dismissedByUser) {
        this.showWizard.set(true);
      }
    });

    effect(() => {
      this.layoutService.hideBreadcrumb.set(this.showWizard());
    });

    this.destroyRef.onDestroy(() => {
      this.layoutService.hideBreadcrumb.set(false);
    });
  }

  onWizardComplete(): void {
    this.dismissedByUser = true;
    this.showWizard.set(false);
  }
}
