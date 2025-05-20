import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';

import { AuthService } from '@chansey-web/app/services';

import { ExchangeBalanceComponent } from '../../components/exchange-balance/exchange-balance.component';
import { RecentTransactionsComponent } from '../../components/recent-transactions/recent-transactions.component';
import { UserAssetsComponent } from '../../components/user-assets/user-assets.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    CardModule,
    ExchangeBalanceComponent,
    UserAssetsComponent,
    RecentTransactionsComponent
  ],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
  // Services
  private authService = inject(AuthService);
  readonly userQuery = this.authService.useUser();
}
