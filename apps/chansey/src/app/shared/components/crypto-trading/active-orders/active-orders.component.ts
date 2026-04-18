import { DecimalPipe, NgClass, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { Order } from '@chansey/api-interfaces';

import { formatOrderType, formatStatus, getStatusClass } from '../crypto-trading.utils';

export interface GroupedOrder {
  type: 'oco-pair' | 'standalone';
  orders: Order[];
  id: string;
}

@Component({
  selector: 'app-active-orders',
  standalone: true,
  imports: [ButtonModule, TooltipModule, DecimalPipe, NgClass, NgTemplateOutlet],
  templateUrl: './active-orders.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActiveOrdersComponent {
  orders = input<Order[]>([]);
  isVisible = input(false);
  isCancelling = input(false);

  isRefreshing = input(false);

  cancelOrder = output<string>();
  cancelOcoPair = output<string[]>();
  refresh = output();

  readonly getStatusClass = getStatusClass;
  readonly formatOrderType = formatOrderType;
  readonly formatStatus = formatStatus;

  groupedOrders = computed<GroupedOrder[]>(() => {
    const orders = this.orders();
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const result: GroupedOrder[] = [];
    const processed = new Set<string>();

    for (const order of orders) {
      if (processed.has(order.id)) continue;

      if (order.ocoLinkedOrderId) {
        const linked = orderMap.get(order.ocoLinkedOrderId);
        if (linked && !processed.has(linked.id)) {
          processed.add(order.id);
          processed.add(linked.id);
          const [firstId, secondId] = [order.id, linked.id].sort();
          result.push({
            type: 'oco-pair',
            orders: [order, linked],
            id: `oco-${firstId}-${secondId}`
          });
          continue;
        }
      }

      processed.add(order.id);
      result.push({ type: 'standalone', orders: [order], id: order.id });
    }

    return result;
  });

  trackByGroupId(_index: number, group: GroupedOrder) {
    return group.id;
  }

  trackByOrderId(_index: number, order: Order) {
    return order.id;
  }

  onCancelOcoPair(orders: Order[]): void {
    this.cancelOcoPair.emit(orders.map((o) => o.id));
  }
}
