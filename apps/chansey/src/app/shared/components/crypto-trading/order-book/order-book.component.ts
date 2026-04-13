import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Decimal } from 'decimal.js';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';

import { OrderBook } from '../../../services/trading';
import { trackByPrice } from '../crypto-trading.utils';

@Component({
  selector: 'app-order-book',
  standalone: true,
  imports: [ButtonModule, SkeletonModule, DecimalPipe],
  templateUrl: './order-book.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrderBookComponent {
  orderBookData = input<OrderBook | undefined>();
  isLoading = input(false);
  isVisible = input(false);
  isRefreshing = input(false);

  refresh = output();

  topBids = computed(() => this.orderBookData()?.bids.slice(0, 5) || []);
  topAsks = computed(() => this.orderBookData()?.asks.slice(0, 5) || []);

  spread = computed(() => {
    const asks = this.topAsks();
    const bids = this.topBids();
    if (!asks.length || !bids.length) return null;
    const bestAsk = asks[0].price;
    const bestBid = bids[0].price;
    const diff = new Decimal(bestAsk).minus(bestBid);
    return {
      value: diff.toNumber(),
      percent: diff.div(bestAsk).times(100).toNumber()
    };
  });

  /** Max quantity across all visible rows, used for depth bar scaling */
  private maxQuantity = computed(() => {
    const all = [...this.topAsks(), ...this.topBids()];
    return Math.max(...all.map((e) => e.quantity), 0);
  });

  topAsksWithDepth = computed(() => {
    const max = this.maxQuantity();
    return this.topAsks().map((a) => ({ ...a, depthPercent: max > 0 ? (a.quantity / max) * 100 : 0 }));
  });

  topBidsWithDepth = computed(() => {
    const max = this.maxQuantity();
    return this.topBids().map((b) => ({ ...b, depthPercent: max > 0 ? (b.quantity / max) * 100 : 0 }));
  });

  readonly trackByPrice = trackByPrice;
}
