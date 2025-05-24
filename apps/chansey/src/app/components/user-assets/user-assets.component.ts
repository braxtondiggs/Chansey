import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, computed, Input } from '@angular/core';

import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
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
  getChangeColor(change: number): string {
    return change >= 0 ? 'text-green-500' : 'text-red-500';
  }

  // Format percentage with plus/minus sign
  formatPercentage(value: number): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  }
}
