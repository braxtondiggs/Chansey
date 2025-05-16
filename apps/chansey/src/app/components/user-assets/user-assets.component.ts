import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal, effect } from '@angular/core';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { UserAsset, UserAssetsService } from './user-assets.service';

@Component({
  selector: 'app-user-assets',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, SkeletonModule, TableModule, TagModule, ProgressSpinnerModule],
  templateUrl: './user-assets.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserAssetsComponent implements OnInit {
  // Service injection
  private assetsService = inject(UserAssetsService);

  // Assets data query
  assetsQuery = this.assetsService.useUserAssets();

  // Data signals
  assets = signal<UserAsset[]>([]);

  constructor() {
    // Use effect to update assets when query data changes
    effect(() => {
      const data = this.assetsQuery.data();
      if (data && Array.isArray(data)) {
        this.assets.set(data);
      }
    });
  }

  ngOnInit() {
    // Component initialization
  }

  getImage(slug: string): string {
    const size = 'small';
    return `https://assets.coingecko.com/coins/images/1/small/${slug?.toLowerCase()}.png`;
  }
}
