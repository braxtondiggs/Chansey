import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal, effect } from '@angular/core';

import { shapes } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { AvatarModule } from 'primeng/avatar';
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

  getImage(slug: string): string {
    return createAvatar(shapes, {
      seed: slug,
      size: 64,
      radius: 64
    }).toDataUri();
  }
}
