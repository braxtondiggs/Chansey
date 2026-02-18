
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';

import { ExchangeBalanceComponent } from '../../shared/components/exchange-balance/exchange-balance.component';
import { RecentTransactionsComponent } from '../../shared/components/recent-transactions/recent-transactions.component';
import { UserAssetsComponent } from '../../shared/components/user-assets/user-assets.component';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
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
