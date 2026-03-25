import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { ButtonModule } from 'primeng/button';

import { Order } from '@chansey/api-interfaces';

import { getStatusClass } from '../crypto-trading.utils';

@Component({
  selector: 'app-active-orders',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  templateUrl: './active-orders.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActiveOrdersComponent {
  orders = input<Order[]>([]);
  isVisible = input(false);
  isCancelling = input(false);

  cancelOrder = output<string>();

  readonly getStatusClass = getStatusClass;

  trackByOrderId(_index: number, order: Order) {
    return order.id;
  }
}
