import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';

import { OrderBook } from '../../../services/trading';
import { trackByPrice } from '../crypto-trading.utils';

@Component({
  selector: 'app-order-book',
  standalone: true,
  imports: [CommonModule, ButtonModule, SkeletonModule],
  templateUrl: './order-book.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrderBookComponent {
  orderBookData = input<OrderBook | undefined>();
  isLoading = input(false);
  isVisible = input(false);
  isRefreshing = input(false);
  showToggle = input(true);

  refresh = output();

  topBids = computed(() => this.orderBookData()?.bids.slice(0, 5) || []);
  topAsks = computed(() => this.orderBookData()?.asks.slice(0, 5) || []);

  readonly trackByPrice = trackByPrice;
}
