import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { ConfirmationService, MessageService } from 'primeng/api';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TabsModule } from 'primeng/tabs';
import { ToastModule } from 'primeng/toast';

import { AccountSettingsComponent } from './components/account-settings/account-settings.component';
import { AppearanceSettingsComponent } from './components/appearance-settings/appearance-settings.component';
import { NotificationSettingsComponent } from './components/notification-settings/notification-settings.component';
import { SecuritySettingsComponent } from './components/security-settings/security-settings.component';
import { TradingSettingsComponent } from './components/trading-settings/trading-settings.component';

const VALID_TABS = ['account', 'trading', 'notification', 'security', 'appearance'] as const;

@Component({
  selector: 'app-settings',
  imports: [
    AccountSettingsComponent,
    AppearanceSettingsComponent,
    CardModule,
    ConfirmDialogModule,
    NotificationSettingsComponent,
    SecuritySettingsComponent,
    TabsModule,
    ToastModule,
    TradingSettingsComponent
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  activeTab: string;

  constructor() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    this.activeTab = tab && VALID_TABS.includes(tab as (typeof VALID_TABS)[number]) ? tab : 'account';
  }

  onTabChange(tab: string | number | undefined): void {
    if (typeof tab !== 'string') return;
    this.activeTab = tab;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'account' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }
}
