import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { Decimal } from 'decimal.js';
import { ConfirmationService, MessageService } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TabsModule } from 'primeng/tabs';
import { ToastModule } from 'primeng/toast';
import { debounceTime, Subject, takeUntil } from 'rxjs';

import {
  Balance,
  Exchange,
  ExchangeKey,
  Order,
  OrderPreview,
  OrderSide,
  OrderStatus,
  OrderType,
  PlaceOrderRequest,
  TickerPair,
  TrailingType
} from '@chansey/api-interfaces';

import { OrderFormComponent } from './order-form/order-form.component';

import { AuthService, LayoutService } from '../../services';
import { ExchangeService } from '../../services/exchange.service';
import {
  buildOrderRequest,
  DEFAULT_FEE_RATE,
  OrderBookEntry,
  TradingMutationService,
  TradingQueryService,
  TradingStateService
} from '../../services/trading';

@Component({
  selector: 'app-crypto-trading',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AvatarModule,
    ButtonModule,
    ConfirmDialogModule,
    OrderFormComponent,
    SelectModule,
    SkeletonModule,
    TabsModule,
    ToastModule
  ],
  templateUrl: './crypto-trading.component.html',
  host: { class: 'block' }
})
export class CryptoTradingComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly tradingQueryService = inject(TradingQueryService);
  private readonly tradingMutationService = inject(TradingMutationService);
  private readonly tradingStateService = inject(TradingStateService);
  private readonly exchangeService = inject(ExchangeService);
  private readonly layoutService = inject(LayoutService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroy$ = new Subject<void>();
  private readonly buyPreviewSubject$ = new Subject<void>();
  private readonly sellPreviewSubject$ = new Subject<void>();

  // Reactive state
  selectedPairValue = signal<string | null>(null);
  selectedExchangeId = signal<string | null>(null);
  activeOrderTab = signal<string>('buy');

  // PrimeNG Pass Through (PT) for tabs
  tabListPt = {
    root: 'bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-1 overflow-hidden',
    tabList: 'bg-transparent !border-none gap-1 w-full flex',
    content: '!border-none',
    activeBar: '!hidden'
  };

  tabPanelsPt = {
    root: '!p-0 bg-transparent'
  };

  private readonly tabInactiveClasses =
    'flex-1 flex justify-center items-center !py-1.5 !px-3 !border-none !bg-transparent m-0 rounded-lg font-semibold text-sm transition-all duration-200 !text-surface-600 dark:!text-surface-300 hover:!bg-surface-200/60 dark:hover:!bg-surface-700/60 hover:!text-surface-800 dark:hover:!text-surface-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50';

  private readonly buyActiveClasses =
    'flex-1 flex justify-center items-center !py-1.5 !px-3 !border-none m-0 rounded-lg font-semibold text-md transition-all duration-200 !bg-green-500 !text-white hover:!bg-green-600 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50';

  private readonly sellActiveClasses =
    'flex-1 flex justify-center items-center !py-1.5 !px-3 !border-none m-0 rounded-lg font-semibold text-md transition-all duration-200 !bg-red-500 !text-white hover:!bg-red-600 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50';

  buyTabPt = computed(() => {
    const classes = this.activeOrderTab() === 'buy' ? this.buyActiveClasses : this.tabInactiveClasses;
    return { root: classes };
  });

  sellTabPt = computed(() => {
    const classes = this.activeOrderTab() === 'sell' ? this.sellActiveClasses : this.tabInactiveClasses;
    return { root: classes };
  });

  showActiveOrders = signal<boolean>(false);
  showOrderBook = signal<boolean>(false);
  selectedBuyPercentage = signal<number | null>(null);
  selectedSellPercentage = signal<number | null>(null);
  buyOrderPreview = signal<OrderPreview | null>(null);
  sellOrderPreview = signal<OrderPreview | null>(null);

  // Forms
  buyOrderForm!: FormGroup;
  sellOrderForm!: FormGroup;

  // Query hooks
  userQuery = this.authService.useUser();
  exchangeQuery = this.exchangeService.useSupportedExchanges();
  tradingPairsQuery = this.tradingQueryService.useTradingPairs(this.selectedExchangeId);
  balancesQuery = this.tradingQueryService.useBalances();
  activeOrdersQuery = this.tradingQueryService.useActiveOrders();

  // Computed values
  selectedPair = computed(() => {
    const pairSymbol = this.selectedPairValue();
    const pairs = this.tradingPairsQuery.data();

    if (!pairSymbol || !pairs) {
      return null;
    }

    // Find pair by comparing uppercase symbols since tradingPairOptions uses toUpperCase()
    const foundPair = pairs.find((pair) => pair.symbol.toUpperCase() === pairSymbol.toUpperCase());
    return foundPair || null;
  });

  // Derived from selectedPair (L4 fix: no duplicate .find() logic)
  selectedSymbol = computed(() => this.selectedPair()?.symbol.toUpperCase() || null);

  orderBookQuery = this.tradingQueryService.useOrderBook(this.selectedSymbol, this.selectedExchangeId);

  // Mutations
  createOrderMutation = this.tradingMutationService.useCreateOrder();
  previewOrderMutation = this.tradingMutationService.usePreviewOrder();
  cancelOrderMutation = this.tradingMutationService.useCancelOrder();

  // Get the exchange key ID for the selected exchange
  selectedExchangeKeyId = computed(() => {
    const exchangeId = this.selectedExchangeId();
    const userExchanges = this.userQuery.data()?.exchanges;

    if (!exchangeId || !userExchanges) return null;

    const userExchange = userExchanges.find((ue: ExchangeKey) => ue.exchangeId === exchangeId);
    return userExchange?.id || null;
  });

  exchangeOptions = computed(() => {
    const supportedExchanges = this.exchangeQuery.data();
    const userExchanges = this.userQuery.data()?.exchanges;

    return supportedExchanges?.map((exchange: Exchange) => {
      // Find matching user exchange to check if it's active
      const userExchange = userExchanges?.find((ue: ExchangeKey) => ue.exchangeId === exchange.id);
      const isActive = userExchange?.isActive || false;

      return {
        label: exchange.name,
        value: exchange.id,
        image: exchange.image,
        status: isActive ? 'connected' : 'disconnected',
        pairCount: exchange.tickerPairsCount || 0
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

  // Supported order types (will be updated from preview response)
  supportedOrderTypes = signal<OrderType[]>([OrderType.MARKET, OrderType.LIMIT]);

  orderTypeOptions = computed(() => {
    const supported = this.supportedOrderTypes();
    return this.enhancedOrderTypeOptions.filter((opt) => supported.includes(opt.value));
  });

  enhancedOrderTypeOptions = [
    {
      label: 'Market',
      value: OrderType.MARKET,
      icon: 'pi pi-bolt',
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
      value: OrderType.STOP_LOSS,
      icon: 'pi pi-shield',
      description: 'Market order triggered when price hits stop price'
    },
    {
      label: 'Stop Limit',
      value: OrderType.STOP_LIMIT,
      icon: 'pi pi-cog',
      description: 'Limit order triggered when price hits stop price'
    },
    {
      label: 'Trailing Stop',
      value: OrderType.TRAILING_STOP,
      icon: 'pi pi-chart-line',
      description: 'Stop order that automatically adjusts with favorable price movements'
    },
    {
      label: 'Take Profit',
      value: OrderType.TAKE_PROFIT,
      icon: 'pi pi-check-circle',
      description: 'Limit order to close position when target profit is reached'
    },
    {
      label: 'OCO',
      value: OrderType.OCO,
      icon: 'pi pi-arrows-h',
      description: 'One-Cancels-Other: Take profit and stop loss pair'
    }
  ];

  quickAmountOptions = [
    { label: '25%', value: 25 },
    { label: '50%', value: 50 },
    { label: '75%', value: 75 },
    { label: 'Max', value: 100 }
  ];

  trailingTypeOptions = [
    { label: 'Amount', value: TrailingType.AMOUNT },
    { label: 'Percentage', value: TrailingType.PERCENTAGE }
  ];

  isExchangeDisconnected = computed(() => {
    const exchangeId = this.selectedExchangeId();
    if (!exchangeId) return false;
    const option = this.exchangeOptions()?.find((ex) => ex.value === exchangeId);
    return option?.status !== 'connected';
  });

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

    // Auto-open order book when a pair is first selected
    effect(() => {
      const pair = this.selectedPair();
      if (pair) {
        this.showOrderBook.set(true);
      }
    });
  }

  ngOnInit() {
    this.initializeForms();
    this.setupFormSubscriptions();
    this.setupPreviewDebounce();
  }

  private setupPreviewDebounce() {
    this.buyPreviewSubject$
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe(() => this.executePreview('BUY'));

    this.sellPreviewSubject$
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe(() => this.executePreview('SELL'));
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeForms() {
    this.buyOrderForm = this.fb.group({
      type: [OrderType.MARKET, Validators.required],
      quantity: [null, [Validators.required, Validators.min(0.00000001)]],
      price: [null],
      stopPrice: [null],
      trailingAmount: [null],
      trailingType: [TrailingType.AMOUNT],
      takeProfitPrice: [null],
      stopLossPrice: [null]
    });

    this.sellOrderForm = this.fb.group({
      type: [OrderType.MARKET, Validators.required],
      quantity: [null, [Validators.required, Validators.min(0.00000001)]],
      price: [null],
      stopPrice: [null],
      trailingAmount: [null],
      trailingType: [TrailingType.AMOUNT],
      takeProfitPrice: [null],
      stopLossPrice: [null]
    });
  }

  private setupFormSubscriptions() {
    // Update validators when order type changes for buy form
    this.buyOrderForm
      .get('type')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((type) => {
        this.updateFormValidators(this.buyOrderForm, type);
        this.triggerPreview('BUY');
      });

    // Update validators when order type changes for sell form
    this.sellOrderForm
      .get('type')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((type) => {
        this.updateFormValidators(this.sellOrderForm, type);
        this.triggerPreview('SELL');
      });

    // Preview order when quantity changes
    this.buyOrderForm
      .get('quantity')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => this.triggerPreview('BUY'));

    this.sellOrderForm
      .get('quantity')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => this.triggerPreview('SELL'));

    // Preview order when price changes (for limit orders)
    this.buyOrderForm
      .get('price')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => this.triggerPreview('BUY'));

    this.sellOrderForm
      .get('price')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => this.triggerPreview('SELL'));
  }

  private updateFormValidators(form: FormGroup, type: OrderType) {
    const controls = ['price', 'stopPrice', 'trailingAmount', 'takeProfitPrice', 'stopLossPrice'];
    controls.forEach((ctrl) => {
      form.get(ctrl)?.clearValidators();
    });

    if (type === OrderType.LIMIT || type === OrderType.STOP_LIMIT) {
      form.get('price')?.setValidators([Validators.required, Validators.min(0.00000001)]);
    }
    if (type === OrderType.STOP_LOSS || type === OrderType.STOP_LIMIT) {
      form.get('stopPrice')?.setValidators([Validators.required, Validators.min(0.00000001)]);
    }
    if (type === OrderType.TRAILING_STOP) {
      form.get('trailingAmount')?.setValidators([Validators.required, Validators.min(0.00000001)]);
    }
    if (type === OrderType.TAKE_PROFIT) {
      form.get('takeProfitPrice')?.setValidators([Validators.required, Validators.min(0.00000001)]);
    }
    if (type === OrderType.OCO) {
      form.get('takeProfitPrice')?.setValidators([Validators.required, Validators.min(0.00000001)]);
      form.get('stopLossPrice')?.setValidators([Validators.required, Validators.min(0.00000001)]);
    }

    controls.forEach((ctrl) => form.get(ctrl)?.updateValueAndValidity());
  }

  onPairChange(event: { value: string }) {
    const symbol = event.value;
    this.selectedPairValue.set(symbol);

    const pair = this.tradingPairsQuery.data()?.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase());
    if (pair) {
      this.tradingStateService.setSelectedPair(pair);
      // Trigger preview to get supported order types
      this.triggerPreview('BUY');
    }
  }

  /**
   * Typed tab change handler (fix M4: removes $any() cast)
   */
  onTabChange(value: string): void {
    this.activeOrderTab.set(value);
  }

  /**
   * Build a PlaceOrderRequest from form data using the shared utility
   */
  private buildPlaceOrderRequest(side: 'BUY' | 'SELL'): PlaceOrderRequest | null {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();
    const exchangeKeyId = this.selectedExchangeKeyId();

    if (!pair || !exchangeKeyId) return null;

    const formValue = form.value;

    return buildOrderRequest(
      exchangeKeyId,
      pair.symbol.toUpperCase(),
      side === 'BUY' ? OrderSide.BUY : OrderSide.SELL,
      formValue.type,
      formValue.quantity || 0,
      {
        price: formValue.price,
        stopPrice: formValue.stopPrice,
        trailingAmount: formValue.trailingAmount,
        trailingType: formValue.trailingType,
        takeProfitPrice: formValue.takeProfitPrice,
        stopLossPrice: formValue.stopLossPrice
      }
    );
  }

  onSubmitOrder(side: 'BUY' | 'SELL') {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;

    if (!form.valid) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Validation Error',
        detail: 'Please fill in all required fields'
      });
      return;
    }

    const orderRequest = this.buildPlaceOrderRequest(side);
    if (!orderRequest) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Please select an exchange and trading pair'
      });
      return;
    }

    const pair = this.selectedPair();
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    const quantity = form.get('quantity')?.value || 0;
    const orderType = form.get('type')?.value || 'MARKET';
    const symbol = pair?.baseAsset?.symbol?.toUpperCase() || '';
    const priceDisplay =
      orderType === OrderType.MARKET ? 'Market Price' : `${form.get('price')?.value || preview?.marketPrice || 0}`;

    this.confirmationService.confirm({
      header: `Confirm ${side} Order`,
      message:
        `${side} ${quantity} ${symbol} at ${priceDisplay}` +
        (preview
          ? ` — Est. ${side === 'BUY' ? 'total' : 'net'}: ${preview.estimatedCost?.toFixed(6)} ${preview.balanceCurrency?.toUpperCase() || ''}`
          : ''),
      icon: side === 'BUY' ? 'pi pi-arrow-up' : 'pi pi-arrow-down',
      acceptLabel: `Place ${side} Order`,
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: side === 'BUY' ? 'p-button-success' : 'p-button-danger',
      accept: () => this.executeOrder(side, form, orderRequest)
    });
  }

  private executeOrder(side: 'BUY' | 'SELL', form: FormGroup, orderRequest: PlaceOrderRequest) {
    this.createOrderMutation.mutate(orderRequest, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Order Placed',
          detail: `${side} order placed successfully`
        });
        form.reset({ type: OrderType.MARKET, trailingType: TrailingType.AMOUNT });
        if (side === 'BUY') {
          this.buyOrderPreview.set(null);
          this.selectedBuyPercentage.set(null);
        } else {
          this.sellOrderPreview.set(null);
          this.selectedSellPercentage.set(null);
        }
      },
      onError: (error: Error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Order Failed',
          detail: error.message || 'Failed to place order'
        });
      }
    });
  }

  cancelOrder(orderId: string) {
    this.cancelOrderMutation.mutate(orderId, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Order Cancelled',
          detail: 'Order cancelled successfully'
        });
      },
      onError: (error: Error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Cancellation Failed',
          detail: error.message || 'Failed to cancel order'
        });
      }
    });
  }

  refreshActiveOrders() {
    this.activeOrdersQuery.refetch();
  }

  /**
   * Trigger order preview with debouncing (300ms)
   */
  private triggerPreview(side: 'BUY' | 'SELL'): void {
    if (side === 'BUY') {
      this.buyPreviewSubject$.next();
    } else {
      this.sellPreviewSubject$.next();
    }
  }

  /**
   * Execute the actual preview API call (called after debounce)
   */
  private executePreview(side: 'BUY' | 'SELL'): void {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const quantity = form.get('quantity')?.value;

    // Only preview if we have a valid quantity
    if (!quantity || quantity <= 0) return;

    const orderRequest = this.buildPlaceOrderRequest(side);
    if (!orderRequest) return;

    this.previewOrderMutation.mutate(orderRequest, {
      onSuccess: (preview) => {
        if (side === 'BUY') {
          this.buyOrderPreview.set(preview);
        } else {
          this.sellOrderPreview.set(preview);
        }

        // Update supported order types if provided
        if (preview.supportedOrderTypes) {
          this.supportedOrderTypes.set(preview.supportedOrderTypes);
        }
      },
      onError: () => {
        // Preview failures are non-critical; silently ignore
      }
    });
  }

  /**
   * Get order total from preview or calculate fallback
   */
  calculateOrderTotal(side: 'BUY' | 'SELL'): number {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();

    // Prefer preview's estimatedCost when available
    if (preview?.estimatedCost !== undefined) return preview.estimatedCost;

    if (!pair) return 0;

    const quantity = form.get('quantity')?.value || 0;
    const orderType = form.get('type')?.value;
    // Use preview's marketPrice as fallback when pair.currentPrice is null
    const marketPrice = pair.currentPrice || preview?.marketPrice || 0;
    const price = orderType === OrderType.MARKET ? marketPrice : form.get('price')?.value || marketPrice;

    return new Decimal(quantity).times(new Decimal(price)).toNumber();
  }

  calculateOrderFees(side: 'BUY' | 'SELL'): number {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    if (preview) return preview.estimatedFee;

    // Fallback: estimate using default fee rate
    return new Decimal(this.calculateOrderTotal(side)).times(new Decimal(DEFAULT_FEE_RATE)).toNumber();
  }

  /**
   * Get fee rate from preview or default
   */
  getFeeRate(side: 'BUY' | 'SELL'): number {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    return preview?.feeRate || DEFAULT_FEE_RATE;
  }

  calculateBuyOrderTotalWithFees(): number {
    const preview = this.buyOrderPreview();
    if (preview) return preview.totalRequired;
    return new Decimal(this.calculateOrderTotal('BUY')).plus(new Decimal(this.calculateOrderFees('BUY'))).toNumber();
  }

  calculateSellOrderNetAmount(): number {
    const preview = this.sellOrderPreview();
    if (preview) return new Decimal(preview.estimatedCost).minus(new Decimal(preview.estimatedFee)).toNumber();
    return new Decimal(this.calculateOrderTotal('SELL')).minus(new Decimal(this.calculateOrderFees('SELL'))).toNumber();
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

  getAvailableBuyBalance(): number {
    const balance = this.getBuyBalance();
    if (!balance) return 0;

    const feeRate = this.getFeeRate('BUY');
    return new Decimal(balance.available).times(new Decimal(1).minus(new Decimal(feeRate))).toNumber();
  }

  getAvailableSellBalance(): number {
    const balance = this.getSellBalance();
    return balance?.available || 0;
  }

  calculateMaxBuyQuantity(): number {
    const availableBalance = this.getAvailableBuyBalance();
    const pair = this.selectedPair();
    const preview = this.buyOrderPreview();

    if (!pair || availableBalance <= 0) return 0;

    // Use preview's marketPrice as fallback when pair.currentPrice is null
    const price = pair.currentPrice || preview?.marketPrice || 0;
    if (price <= 0) return 0;

    return new Decimal(availableBalance).div(new Decimal(price)).toNumber();
  }

  getTopBids() {
    return this.orderBookQuery.data()?.bids.slice(0, 5) || [];
  }

  getTopAsks() {
    return this.orderBookQuery.data()?.asks.slice(0, 5) || [];
  }

  getStatusClass(status: OrderStatus): string {
    const classes: Record<OrderStatus, string> = {
      [OrderStatus.NEW]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      [OrderStatus.PARTIALLY_FILLED]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      [OrderStatus.FILLED]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      [OrderStatus.CANCELED]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      [OrderStatus.PENDING_CANCEL]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      [OrderStatus.REJECTED]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      [OrderStatus.EXPIRED]: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  }

  trackByPrice(_index: number, item: OrderBookEntry) {
    return item.price;
  }

  trackByOrderId(_index: number, order: Order) {
    return order.id;
  }

  setQuantityPercentage(side: 'BUY' | 'SELL', percentage: number) {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();

    if (!pair) return;

    // Get price from pair or fallback to preview's market price
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    const price = pair.currentPrice || preview?.marketPrice || 0;

    if (side === 'BUY') {
      this.selectedBuyPercentage.set(percentage);
      const availableBalance = this.getAvailableBuyBalance();
      const amountToSpend = availableBalance * (percentage / 100);
      const quantity = price > 0 ? amountToSpend / price : 0;
      form.get('quantity')?.setValue(quantity);
    } else {
      this.selectedSellPercentage.set(percentage);
      const quantity = this.getAvailableSellBalance() * (percentage / 100);
      form.get('quantity')?.setValue(quantity);
    }
  }

  onBuyPercentageChange(percentage: number | null) {
    if (percentage !== null) this.setQuantityPercentage('BUY', percentage);
  }

  onSellPercentageChange(percentage: number | null) {
    if (percentage !== null) this.setQuantityPercentage('SELL', percentage);
  }

  getTradingFeeRate(): number {
    return (this.getFeeRate('BUY') || DEFAULT_FEE_RATE) * 100; // Return as percentage
  }

  onExchangeChange(event: { value: string }) {
    const exchangeId = event.value;
    this.selectedExchangeId.set(exchangeId);
    this.selectedPairValue.set(null);
    this.buyOrderPreview.set(null);
    this.sellOrderPreview.set(null);

    this.messageService.add({
      severity: 'info',
      summary: 'Exchange Selected',
      detail: `Switched to ${this.getSelectedExchangeName()}`
    });
  }

  navigateToExchangeSetup(): void {
    this.layoutService.updateLayoutState({ rightMenuVisible: false });
    const exchangeSlug = this.exchangeQuery.data()?.find((e) => e.id === this.selectedExchangeId())?.slug;
    this.router.navigate(['/app/settings'], {
      queryParams: { tab: 'trading', ...(exchangeSlug && { exchange: exchangeSlug }) },
      fragment: 'exchanges'
    });
  }

  getSelectedExchangeName(): string {
    const exchangeId = this.selectedExchangeId();
    const exchange = this.exchangeOptions()?.find((ex) => ex.value === exchangeId);
    return exchange?.label || 'No Exchange';
  }

  /**
   * Get preview warnings if any
   */
  getPreviewWarnings(side: 'BUY' | 'SELL'): string[] {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    return preview?.warnings || [];
  }

  /**
   * Check if order has sufficient balance
   */
  hasSufficientBalance(side: 'BUY' | 'SELL'): boolean {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    return preview?.hasSufficientBalance ?? true;
  }
}
