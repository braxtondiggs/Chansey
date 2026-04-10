import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { type Order, OrderSide, OrderStatus, OrderType } from '@chansey/api-interfaces';

import { ActiveOrdersComponent } from './active-orders.component';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    symbol: 'BTC/USD',
    side: OrderSide.BUY,
    status: OrderStatus.NEW,
    quantity: 1,
    price: 50000,
    orderType: OrderType.LIMIT,
    ...overrides
  } as Order;
}

describe('ActiveOrdersComponent', () => {
  let component: ActiveOrdersComponent;
  let fixture: ComponentFixture<ActiveOrdersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActiveOrdersComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ActiveOrdersComponent);
    component = fixture.componentInstance;
  });

  describe('groupedOrders', () => {
    it('should return empty array for empty orders', () => {
      fixture.componentRef.setInput('orders', []);
      fixture.detectChanges();
      expect(component.groupedOrders()).toEqual([]);
    });

    it('should group two mutually linked OCO orders into one pair without double-grouping', () => {
      const orderA = makeOrder({ id: 'a', ocoLinkedOrderId: 'b' });
      const orderB = makeOrder({ id: 'b', ocoLinkedOrderId: 'a' });
      fixture.componentRef.setInput('orders', [orderA, orderB]);
      fixture.detectChanges();

      const groups = component.groupedOrders();
      expect(groups).toHaveLength(1);
      expect(groups[0].type).toBe('oco-pair');
      expect(groups[0].orders.map((o: Order) => o.id).sort()).toEqual(['a', 'b']);
      expect(groups[0].id).toBe('oco-a-b');
    });

    it('should fall back to standalone when ocoLinkedOrderId references non-existent order', () => {
      const order = makeOrder({ id: 'a', ocoLinkedOrderId: 'non-existent' });
      fixture.componentRef.setInput('orders', [order]);
      fixture.detectChanges();

      const groups = component.groupedOrders();
      expect(groups).toHaveLength(1);
      expect(groups[0].type).toBe('standalone');
      expect(groups[0].id).toBe('a');
    });

    it('should pair orders when only one side has ocoLinkedOrderId', () => {
      const orderA = makeOrder({ id: 'a', ocoLinkedOrderId: 'b' });
      const orderB = makeOrder({ id: 'b' });
      fixture.componentRef.setInput('orders', [orderA, orderB]);
      fixture.detectChanges();

      const groups = component.groupedOrders();
      expect(groups).toHaveLength(1);
      expect(groups[0].type).toBe('oco-pair');
    });

    it('should handle mixed OCO pairs and standalone orders', () => {
      const orderA = makeOrder({ id: 'a', ocoLinkedOrderId: 'b' });
      const orderB = makeOrder({ id: 'b', ocoLinkedOrderId: 'a' });
      const orderC = makeOrder({ id: 'c' });
      const orderD = makeOrder({ id: 'd' });
      fixture.componentRef.setInput('orders', [orderA, orderB, orderC, orderD]);
      fixture.detectChanges();

      const groups = component.groupedOrders();
      expect(groups).toHaveLength(3);
      expect(groups.map((g) => g.type)).toEqual(['oco-pair', 'standalone', 'standalone']);
    });

    it('should only pair the first linker when two orders both link to the same target', () => {
      const orderA = makeOrder({ id: 'a', ocoLinkedOrderId: 'c' });
      const orderB = makeOrder({ id: 'b', ocoLinkedOrderId: 'c' });
      const orderC = makeOrder({ id: 'c' });
      fixture.componentRef.setInput('orders', [orderA, orderB, orderC]);
      fixture.detectChanges();

      const groups = component.groupedOrders();
      // A pairs with C first; B falls to standalone since C is already processed
      expect(groups).toHaveLength(2);
      expect(groups[0].type).toBe('oco-pair');
      expect(groups[0].orders.map((o: Order) => o.id)).toEqual(['a', 'c']);
      expect(groups[1].type).toBe('standalone');
      expect(groups[1].orders[0].id).toBe('b');
    });
  });

  describe('onCancelOcoPair', () => {
    it('should emit order IDs', () => {
      const spy = jest.fn();
      component.cancelOcoPair.subscribe(spy);

      const orders = [makeOrder({ id: 'x' }), makeOrder({ id: 'y' })];
      component.onCancelOcoPair(orders);

      expect(spy).toHaveBeenCalledWith(['x', 'y']);
    });
  });
});
