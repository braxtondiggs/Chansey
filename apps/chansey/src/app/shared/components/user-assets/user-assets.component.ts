import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, computed, Input } from '@angular/core';

import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { PaginatorModule } from 'primeng/paginator';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { UserAssetsService } from './user-assets.service';

@Component({
  selector: 'app-user-assets',
  standalone: true,
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    CommonModule,
    PaginatorModule,
    ProgressSpinnerModule,
    SkeletonModule,
    TableModule,
    TagModule
  ],
  templateUrl: './user-assets.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserAssetsComponent {
  @Input() limit = 10;

  // Service injection
  private readonly assetsService = inject(UserAssetsService);

  // Assets data query
  assetsQuery = this.assetsService.useUserAssets();

  // Computed states
  assets = computed(() => this.assetsQuery.data() || []);

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
