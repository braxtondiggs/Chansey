import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterModule } from '@angular/router';

import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { PaginatorModule } from 'primeng/paginator';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { UserAssetsService } from './user-assets.service';

import { EmptyStateComponent } from '../empty-state/empty-state.component';

@Component({
  selector: 'app-user-assets',
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    CurrencyPipe,
    DecimalPipe,
    EmptyStateComponent,
    PaginatorModule,
    ProgressSpinnerModule,
    RouterModule,
    SkeletonModule,
    TableModule,
    TagModule
  ],
  templateUrl: './user-assets.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserAssetsComponent {
  readonly limit = input(10);

  // Service injection
  private readonly assetsService = inject(UserAssetsService);

  // Assets data query
  assetsQuery = this.assetsService.useUserAssets();

  // Computed states
  assets = computed(() => this.assetsQuery.data() || []);
  skeletonRows = computed(() => Array.from({ length: Math.min(this.limit(), 4) }, (_, i) => i));

  // Calculate total value (price * quantity)
  calculateTotalValue(price: number, quantity: number): number {
    return price * quantity;
  }

  // Get appropriate color for percentage change
  getChangeColor(change: number | undefined): string {
    if (change === null || change === undefined) return 'text-gray-500';
    return change >= 0 ? 'text-green-500' : 'text-red-500';
  }

  // Format percentage with plus/minus sign
  formatPercentage(value: number | string | null | undefined): string {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (numValue === null || numValue === undefined || isNaN(numValue)) return '--';

    const sign = numValue >= 0 ? '+' : '';
    return `${sign}${numValue.toFixed(2)}%`;
  }
}
