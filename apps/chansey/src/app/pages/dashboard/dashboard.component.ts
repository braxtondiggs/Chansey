import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';

import {
  ExchangeBalanceComponent,
  RecentTransactionsComponent,
  UserAssetsComponent
} from '@chansey-web/app/shared/components';
import { AuthService } from '@chansey-web/app/shared/services';

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
