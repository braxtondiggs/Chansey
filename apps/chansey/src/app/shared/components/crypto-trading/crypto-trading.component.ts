import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, OnDestroy, signal, computed, effect } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';

import { MessageService } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { Subject, takeUntil } from 'rxjs';

import { OrderSide, OrderType, OrderStatus, Exchange, TickerPair } from '@chansey/api-interfaces';

import { AuthService } from '../../services';
import { CryptoTradingService, Balance } from '../../services/crypto-trading.service';
import { ExchangeService } from '../../services/exchange.service';

@Component({
  selector: 'app-crypto-trading',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    AvatarModule,
    ButtonModule,
    CardModule,
    InputNumberModule,
    SelectModule,
    TabsModule,
    TableModule,
    ToastModule,
    TooltipModule
  ],
  templateUrl: './crypto-trading.component.html'
})
export class CryptoTradingComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly tradingService = inject(CryptoTradingService);
  private readonly exchangeService = inject(ExchangeService);
  private readonly fb = inject(FormBuilder);
  private readonly messageService = inject(MessageService);
  private readonly destroy$ = new Subject<void>();

  // Reactive state
  selectedPairValue = signal<string | null>(null);
  selectedExchangeId = signal<string | null>(null);
  activeOrderTab = signal<string>('buy');
  showActiveOrders = signal<boolean>(true);

  // Forms
  buyOrderForm!: FormGroup;
  sellOrderForm!: FormGroup;

  // Query hooks
  userQuery = this.authService.useUser();
  exchangeQuery = this.exchangeService.useSupportedExchanges();
  tradingPairsQuery = this.tradingService.useTradingPairs(this.selectedExchangeId);
  balancesQuery = this.tradingService.useBalances();
  activeOrdersQuery = this.tradingService.useActiveOrders();

  // Mutations
  createOrderMutation = this.tradingService.useCreateOrder();
  cancelOrderMutation = this.tradingService.useCancelOrder();

  // Computed values
  selectedPair = computed(() => {
    const pairSymbol = this.selectedPairValue();
    if (!pairSymbol || !this.tradingPairsQuery.data()) return null;
    return this.tradingPairsQuery.data()?.find((pair) => pair.symbol === pairSymbol) || null;
  });

  orderBookQuery = computed(() => {
    const pair = this.selectedPair();
    return pair ? this.tradingService.useOrderBook(pair.symbol) : null;
  });

  exchangeOptions = computed(() => {
    const supportedExchanges = this.exchangeQuery.data();
    const userExchanges = this.userQuery.data()?.exchanges;

    return supportedExchanges?.map((exchange: Exchange) => {
      // Find matching user exchange to check if it's active
      const userExchange = userExchanges?.find((ue: any) => ue.exchangeId === exchange.id);
      const isActive = userExchange?.isActive || false;

      return {
        label: exchange.name,
        value: exchange.id,
        image: exchange.image,
        status: isActive ? 'connected' : 'disconnected',
        pairCount: 0
      };
    });
  });

  tradingPairOptions = computed(() => {
    const pairs = this.tradingPairsQuery.data() || [];
    const selectedExchange = this.selectedExchangeId();

    return pairs.map((pair: TickerPair) => ({
      label: `${pair.baseAsset?.symbol}/${pair.quoteAsset?.symbol}`.toUpperCase(),
      value: pair.symbol.toUpperCase(),
      exchangeId: selectedExchange || pair.exchange?.id,
      price: pair.currentPrice,
      change24h: pair.spreadPercentage || 0
    }));
  });

  orderTypeOptions = [
    { label: 'Market', value: OrderType.MARKET },
    { label: 'Limit', value: OrderType.LIMIT }
  ];

  enhancedOrderTypeOptions = [
    {
      label: 'Market',
      value: OrderType.MARKET,
      icon: 'pi pi-flash',
      description: 'Execute immediately at current market price'
    },
    {
      label: 'Limit',
      value: OrderType.LIMIT,
      icon: 'pi pi-list',
      description: 'Execute only at your specified price or better'
    },
    {
      label: 'Stop Loss',
      value: 'STOP_LOSS',
      icon: 'pi pi-shield',
      description: 'Market order triggered when price hits stop price'
    },
    {
      label: 'Stop Limit',
      value: 'STOP_LIMIT',
      icon: 'pi pi-cog',
      description: 'Limit order triggered when price hits stop price'
    }
  ];

  // Auto-select the first connected exchange when available
  private shouldAutoSelect = computed(() => {
    const exchanges = this.exchangeOptions();
    const currentSelection = this.selectedExchangeId();

    if (!exchanges || exchanges.length === 0 || currentSelection) {
      return null;
    }

    const connectedExchanges = exchanges.filter((ex) => ex.status === 'connected');
    return connectedExchanges.length > 0 ? connectedExchanges[0] : null;
  });

  constructor() {
    // Watch for auto-selection opportunities
    effect(() => {
      const exchangeToSelect = this.shouldAutoSelect();
      if (exchangeToSelect) {
        this.selectedExchangeId.set(exchangeToSelect.value);
      }
    });
  }

  ngOnInit() {
    this.initializeForms();
    this.setupFormSubscriptions();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeForms() {
    this.buyOrderForm = this.fb.group({
      type: [OrderType.MARKET, Validators.required],
      quantity: [null, [Validators.required, Validators.min(0.001)]],
      price: [null],
      stopPrice: [null]
    });

    this.sellOrderForm = this.fb.group({
      type: [OrderType.MARKET, Validators.required],
      quantity: [null, [Validators.required, Validators.min(0.001)]],
      price: [null],
      stopPrice: [null]
    });
  }

  private setupFormSubscriptions() {
    // Update validators when order type changes
    this.buyOrderForm
      .get('type')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((type) => {
        const priceControl = this.buyOrderForm.get('price');
        const stopPriceControl = this.buyOrderForm.get('stopPrice');

        // Reset validators
        priceControl?.clearValidators();
        stopPriceControl?.clearValidators();

        // Set validators based on order type
        if (type === OrderType.LIMIT || type === 'STOP_LIMIT') {
          priceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }
        if (type === 'STOP_LOSS' || type === 'STOP_LIMIT') {
          stopPriceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }

        priceControl?.updateValueAndValidity();
        stopPriceControl?.updateValueAndValidity();
      });

    this.sellOrderForm
      .get('type')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((type) => {
        const priceControl = this.sellOrderForm.get('price');
        const stopPriceControl = this.sellOrderForm.get('stopPrice');

        // Reset validators
        priceControl?.clearValidators();
        stopPriceControl?.clearValidators();

        // Set validators based on order type
        if (type === OrderType.LIMIT || type === 'STOP_LIMIT') {
          priceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }
        if (type === 'STOP_LOSS' || type === 'STOP_LIMIT') {
          stopPriceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }

        priceControl?.updateValueAndValidity();
        stopPriceControl?.updateValueAndValidity();
      });
  }

  onPairChange(event: { value: string }) {
    const symbol = event.value;
    this.selectedPairValue.set(symbol);

    const pair = this.tradingPairsQuery.data()?.find((p) => p.symbol === symbol);
    if (pair) {
      this.tradingService.setSelectedPair(pair);
    }
  }

  onSubmitOrder(side: 'BUY' | 'SELL') {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();

    if (!form.valid || !pair) return;

    const formValue = form.value;
    const orderData = {
      baseCoinId: pair.baseAsset?.id,
      quantity: formValue.quantity.toString(),
      price: formValue.price?.toString(),
      type: formValue.type,
      side: side === 'BUY' ? OrderSide.BUY : OrderSide.SELL
    };

    /*this.createOrderMutation.mutate(orderData, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: `${side} order placed successfully`
        });
        form.reset({ type: OrderType.MARKET });
      },
      onError: (error: Error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: error.message || 'Failed to place order'
        });
      }
    });*/
  }

  quickBuy() {
    const pair = this.selectedPair();
    if (!pair) return;

    this.activeOrderTab.set('buy');
    this.buyOrderForm.patchValue({
      type: OrderType.MARKET,
      quantity: 0.001 // Default small amount
    });
  }

  quickSell() {
    const pair = this.selectedPair();
    if (!pair) return;

    this.activeOrderTab.set('sell');
    this.sellOrderForm.patchValue({
      type: OrderType.MARKET,
      quantity: 0.001 // Default small amount
    });
  }

  cancelOrder(orderId: string) {
    this.cancelOrderMutation.mutate(orderId, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Order cancelled successfully'
        });
      },
      onError: (error: any) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: error.message || 'Failed to cancel order'
        });
      }
    });
  }

  refreshActiveOrders() {
    this.activeOrdersQuery.refetch();
  }

  calculateOrderTotal(side: 'BUY' | 'SELL'): number {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();

    if (!pair || !form.valid) return 0;

    const quantity = form.get('quantity')?.value || 0;
    const price = form.get('price')?.value || pair.currentPrice || 0;

    return quantity * price;
  }

  calculateOrderFees(side: 'BUY' | 'SELL'): number {
    const total = this.calculateOrderTotal(side);
    return total * 0.001; // 0.1% fee estimation
  }

  getBuyBalance(): Balance | undefined {
    const pair = this.selectedPair();
    const balances = this.balancesQuery.data();

    if (!pair || !balances) return undefined;

    return balances.find((b) => b.coin.id === pair.quoteAsset?.id);
  }

  getSellBalance(): Balance | undefined {
    const pair = this.selectedPair();
    const balances = this.balancesQuery.data();

    if (!pair || !balances) return undefined;

    return balances.find((b) => b.coin.id === pair.baseAsset?.id);
  }

  getTopBids() {
    const orderBook = this.orderBookQuery()?.data();
    return orderBook?.bids.slice(0, 5) || [];
  }

  getTopAsks() {
    const orderBook = this.orderBookQuery()?.data();
    return orderBook?.asks.slice(0, 5) || [];
  }

  calculateSpread(): number {
    const pair = this.selectedPair();
    // if (!pair?.bid || !pair?.ask) return 0;

    return 5; // return this.tradingService.calculateSpread(pair.bid, pair.ask);
  }

  priceChangeClass(): string {
    const change = this.selectedPair()?.spreadPercentage || 0;
    return change >= 0 ? 'text-green-600' : 'text-red-600';
  }

  getStatusClass(status: OrderStatus): string {
    switch (status) {
      case OrderStatus.NEW:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case OrderStatus.PARTIALLY_FILLED:
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case OrderStatus.FILLED:
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case OrderStatus.CANCELED:
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  }

  trackByPrice(_index: number, item: any) {
    return item.price;
  }

  trackByOrderId(_index: number, order: any) {
    return order.id;
  }

  // Enhanced functionality methods
  setQuantityPercentage(side: 'BUY' | 'SELL', percentage: number) {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const balance = side === 'BUY' ? this.getBuyBalance() : this.getSellBalance();
    const pair = this.selectedPair();

    if (!balance || !pair) return;

    let quantity: number;
    if (side === 'BUY') {
      // For buying, calculate quantity based on available quote currency
      const availableAmount = balance.available * (percentage / 100);
      const currentPrice = pair.currentPrice || 0;
      quantity = currentPrice > 0 ? availableAmount / currentPrice : 0;
    } else {
      // For selling, calculate quantity based on available base currency
      quantity = balance.available * (percentage / 100);
    }

    form.get('quantity')?.setValue(quantity);
  }

  calculateMaxBuyQuantity(): number {
    const balance = this.getBuyBalance();
    const pair = this.selectedPair();

    if (!balance || !pair || !pair.currentPrice) return 0;

    return balance.available / pair.currentPrice;
  }

  getTradingFeeRate(): number {
    // This should come from exchange configuration or user settings
    return 0.1; // 0.1% default trading fee
  }

  onExchangeChange(event: { value: string }) {
    const exchangeId = event.value;
    this.selectedExchangeId.set(exchangeId);

    // Clear selected pair when exchange changes
    this.selectedPairValue.set(null);

    // Set the active exchange for trading operations
    // this.tradingService.setActiveExchange(exchangeId); // Uncomment when method is available

    this.messageService.add({
      severity: 'info',
      summary: 'Exchange Selected',
      detail: `Switched to ${this.getSelectedExchangeName()}`
    });
  }

  getSelectedExchangeName(): string {
    const exchangeId = this.selectedExchangeId();
    const exchanges = this.exchangeOptions();
    const exchange = exchanges?.find((ex: any) => ex.value === exchangeId);
    return exchange?.label || 'No Exchange';
  }

  getExchangeStatusClass(status: string): string {
    return status === 'connected' ? 'bg-green-500' : 'bg-red-500';
  }

  getExchangeStatusTextClass(status: string): string {
    return status === 'connected' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  }
}
