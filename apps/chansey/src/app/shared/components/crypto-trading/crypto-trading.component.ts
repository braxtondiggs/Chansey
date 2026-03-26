import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

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
  DEFAULT_EXIT_CONFIG,
  Exchange,
  ExchangeKey,
  ExitConfigRequest,
  MarketLimits,
  OrderPreview,
  OrderSide,
  OrderType,
  PlaceOrderRequest,
  TickerPair,
  TrailingActivationType,
  TrailingType
} from '@chansey/api-interfaces';

import { ActiveOrdersComponent } from './active-orders/active-orders.component';
import {
  BUY_ACTIVE_CLASSES,
  ENHANCED_ORDER_TYPE_OPTIONS,
  QUICK_AMOUNT_OPTIONS,
  SELL_ACTIVE_CLASSES,
  TAB_INACTIVE_CLASSES,
  TAB_LIST_PT,
  TAB_PANELS_PT,
  TRAILING_TYPE_OPTIONS
} from './crypto-trading.constants';
import {
  calculateBuyOrderTotalWithFees,
  calculateSellOrderNetAmount,
  getAvailableBuyBalance,
  getAvailableSellBalance,
  getFeeRate,
  getPreviewWarnings,
  hasSufficientBalance
} from './crypto-trading.utils';
import { OrderBookComponent } from './order-book/order-book.component';
import { OrderFormComponent } from './order-form/order-form.component';

import { AuthService, LayoutService } from '../../services';
import { ExchangeService } from '../../services/exchange.service';
import {
  buildOrderRequest,
  DEFAULT_FEE_RATE,
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
    ActiveOrdersComponent,
    AvatarModule,
    ButtonModule,
    ConfirmDialogModule,
    OrderBookComponent,
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

  // PT & classes from constants
  tabListPt = TAB_LIST_PT;
  tabPanelsPt = TAB_PANELS_PT;

  buyTabPt = computed(() => ({
    root: this.activeOrderTab() === 'buy' ? BUY_ACTIVE_CLASSES : TAB_INACTIVE_CLASSES
  }));

  sellTabPt = computed(() => ({
    root: this.activeOrderTab() === 'sell' ? SELL_ACTIVE_CLASSES : TAB_INACTIVE_CLASSES
  }));

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
    if (!pairSymbol || !pairs) return null;
    return pairs.find((pair) => pair.symbol.toUpperCase() === pairSymbol.toUpperCase()) || null;
  });

  selectedSymbol = computed(() => this.selectedPair()?.symbol.toUpperCase() || null);
  orderBookQuery = this.tradingQueryService.useOrderBook(this.selectedSymbol, this.selectedExchangeId);

  // Mutations
  createOrderMutation = this.tradingMutationService.useCreateOrder();
  previewOrderMutation = this.tradingMutationService.usePreviewOrder();
  cancelOrderMutation = this.tradingMutationService.useCancelOrder();

  selectedExchangeKeyId = computed(() => {
    const exchangeId = this.selectedExchangeId();
    const userExchanges = this.userQuery.data()?.exchanges;
    if (!exchangeId || !userExchanges) return null;
    const userExchange = userExchanges.find((ue: ExchangeKey) => ue.exchangeId === exchangeId);
    return userExchange?.id || null;
  });

  marketLimitsQuery = this.tradingQueryService.useMarketLimits(this.selectedSymbol, this.selectedExchangeKeyId);
  marketLimits = computed<MarketLimits | null>(() => this.marketLimitsQuery.data() ?? null);

  exchangeOptions = computed(() => {
    const supportedExchanges = this.exchangeQuery.data();
    const userExchanges = this.userQuery.data()?.exchanges;
    return supportedExchanges?.map((exchange: Exchange) => {
      const userExchange = userExchanges?.find((ue: ExchangeKey) => ue.exchangeId === exchange.id);
      return {
        label: exchange.name,
        value: exchange.id,
        image: exchange.image,
        status: userExchange?.isActive ? 'connected' : 'disconnected',
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

  supportedOrderTypes = signal<OrderType[]>([OrderType.MARKET, OrderType.LIMIT]);

  orderTypeOptions = computed(() => {
    const supported = this.supportedOrderTypes();
    return ENHANCED_ORDER_TYPE_OPTIONS.filter((opt) => supported.includes(opt.value));
  });

  quickAmountOptions = QUICK_AMOUNT_OPTIONS;
  trailingTypeOptions = TRAILING_TYPE_OPTIONS;

  isExchangeDisconnected = computed(() => {
    const exchangeId = this.selectedExchangeId();
    if (!exchangeId) return false;
    return this.exchangeOptions()?.find((ex) => ex.value === exchangeId)?.status !== 'connected';
  });

  private shouldAutoSelect = computed(() => {
    const exchanges = this.exchangeOptions();
    const currentSelection = this.selectedExchangeId();
    if (!exchanges || exchanges.length === 0 || currentSelection) return null;
    const connected = exchanges.filter((ex) => ex.status === 'connected');
    return connected.length > 0 ? connected[0] : null;
  });

  // Computed balance/fee data for template
  buyTotalWithFees = computed(() =>
    calculateBuyOrderTotalWithFees(this.buyOrderForm, this.selectedPair(), this.buyOrderPreview())
  );
  sellNetAmount = computed(() =>
    calculateSellOrderNetAmount(this.sellOrderForm, this.selectedPair(), this.sellOrderPreview())
  );
  buyHasSufficientBalance = computed(() => hasSufficientBalance(this.buyOrderPreview()));
  sellHasSufficientBalance = computed(() => hasSufficientBalance(this.sellOrderPreview()));
  tradingFeeRate = computed(() => (getFeeRate(this.buyOrderPreview()) || DEFAULT_FEE_RATE) * 100);

  constructor() {
    effect(() => {
      const exchangeToSelect = this.shouldAutoSelect();
      if (exchangeToSelect) {
        this.selectedExchangeId.set(exchangeToSelect.value);
      }
    });

    effect(() => {
      const pair = this.selectedPair();
      if (pair) {
        this.showOrderBook.set(true);
      }
    });

    effect(() => {
      const limits = this.marketLimits();
      if (limits && this.buyOrderForm && this.sellOrderForm) {
        this.applyMarketLimitsValidators(this.buyOrderForm, limits);
        this.applyMarketLimitsValidators(this.sellOrderForm, limits);
      }
    });
  }

  ngOnInit() {
    this.initializeForms();
    this.setupFormSubscriptions();
    this.setupPreviewDebounce();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onTabChange(value: string): void {
    this.activeOrderTab.set(value);
  }

  onPairChange(event: { value: string }) {
    const symbol = event.value;
    this.selectedPairValue.set(symbol);
    const pair = this.tradingPairsQuery.data()?.find((p) => p.symbol?.toUpperCase() === symbol?.toUpperCase());
    if (pair) {
      this.tradingStateService.setSelectedPair(pair);
      this.triggerPreview('BUY');
    }
  }

  onExchangeChange(event: { value: string }) {
    this.selectedExchangeId.set(event.value);
    this.selectedPairValue.set(null);
    this.buyOrderPreview.set(null);
    this.sellOrderPreview.set(null);
    this.messageService.add({
      severity: 'info',
      summary: 'Exchange Selected',
      detail: `Switched to ${this.getSelectedExchangeName()}`
    });
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

    const exitConfig = this.buildExitConfig(form.get('exitConfig') as FormGroup);
    let exitSummary = '';
    if (exitConfig) {
      const parts: string[] = [];
      if (exitConfig.enableStopLoss) parts.push(`${exitConfig.stopLossValue}% stop-loss`);
      if (exitConfig.enableTakeProfit) parts.push(`${exitConfig.takeProfitValue}% take-profit`);
      if (exitConfig.enableTrailingStop) parts.push(`${exitConfig.trailingValue}% trailing stop`);
      if (parts.length > 0) exitSummary = ` with ${parts.join(' and ')}`;
    }

    this.confirmationService.confirm({
      header: `Confirm ${side} Order`,
      message:
        `${side} ${quantity} ${symbol} at ${priceDisplay}${exitSummary}` +
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

  cancelOcoPair(orderIds: string[]) {
    if (orderIds.length === 0) return;
    // Cancel first order only — exchange automatically cancels the linked OCO order
    this.cancelOrderMutation.mutate(orderIds[0], {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'OCO Pair Cancelled',
          detail: 'Both linked OCO orders cancelled successfully'
        });
      },
      onError: (error: Error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Cancellation Failed',
          detail: error.message || 'Failed to cancel OCO orders'
        });
      }
    });
  }

  refreshActiveOrders() {
    this.activeOrdersQuery.refetch();
  }

  onBuyPercentageChange(percentage: number | null) {
    if (percentage !== null) this.setQuantityPercentage('BUY', percentage);
  }

  onSellPercentageChange(percentage: number | null) {
    if (percentage !== null) this.setQuantityPercentage('SELL', percentage);
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
    return this.exchangeOptions()?.find((ex) => ex.value === exchangeId)?.label || 'No Exchange';
  }

  getPreviewWarnings(side: 'BUY' | 'SELL'): string[] {
    return getPreviewWarnings(side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview());
  }

  // --- Private methods ---

  private setupPreviewDebounce() {
    this.buyPreviewSubject$
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe(() => this.executePreview('BUY'));
    this.sellPreviewSubject$
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe(() => this.executePreview('SELL'));
  }

  private initializeForms() {
    const formConfig = {
      type: [OrderType.MARKET, Validators.required],
      quantity: [null, [Validators.required, Validators.min(0.00000001)]],
      price: [null],
      stopPrice: [null],
      trailingAmount: [null],
      trailingType: [TrailingType.AMOUNT],
      takeProfitPrice: [null],
      stopLossPrice: [null]
    };
    this.buyOrderForm = this.fb.group(formConfig);
    this.sellOrderForm = this.fb.group({ ...formConfig });
    this.buyOrderForm.addControl('exitConfig', this.createExitConfigFormGroup());
    this.sellOrderForm.addControl('exitConfig', this.createExitConfigFormGroup());
  }

  private createExitConfigFormGroup(): FormGroup {
    return this.fb.group({
      enableStopLoss: [DEFAULT_EXIT_CONFIG.enableStopLoss],
      stopLossType: [DEFAULT_EXIT_CONFIG.stopLossType],
      stopLossValue: [DEFAULT_EXIT_CONFIG.stopLossValue],
      enableTakeProfit: [DEFAULT_EXIT_CONFIG.enableTakeProfit],
      takeProfitType: [DEFAULT_EXIT_CONFIG.takeProfitType],
      takeProfitValue: [DEFAULT_EXIT_CONFIG.takeProfitValue],
      enableTrailingStop: [DEFAULT_EXIT_CONFIG.enableTrailingStop],
      trailingType: [DEFAULT_EXIT_CONFIG.trailingType],
      trailingValue: [DEFAULT_EXIT_CONFIG.trailingValue],
      trailingActivation: [DEFAULT_EXIT_CONFIG.trailingActivation],
      trailingActivationValue: [null],
      useOco: [DEFAULT_EXIT_CONFIG.useOco]
    });
  }

  private setupFormSubscriptions() {
    const subscribe = (form: FormGroup, side: 'BUY' | 'SELL') => {
      form
        .get('type')
        ?.valueChanges.pipe(takeUntil(this.destroy$))
        .subscribe((type) => {
          this.updateFormValidators(form, type);
          this.triggerPreview(side);
        });
      form
        .get('quantity')
        ?.valueChanges.pipe(takeUntil(this.destroy$))
        .subscribe(() => this.triggerPreview(side));
      form
        .get('price')
        ?.valueChanges.pipe(takeUntil(this.destroy$))
        .subscribe(() => this.triggerPreview(side));
    };
    subscribe(this.buyOrderForm, 'BUY');
    subscribe(this.sellOrderForm, 'SELL');
  }

  private updateFormValidators(form: FormGroup, type: OrderType) {
    const controls = ['price', 'stopPrice', 'trailingAmount', 'takeProfitPrice', 'stopLossPrice'];
    controls.forEach((ctrl) => form.get(ctrl)?.clearValidators());

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

  private buildPlaceOrderRequest(side: 'BUY' | 'SELL'): PlaceOrderRequest | null {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();
    const exchangeKeyId = this.selectedExchangeKeyId();
    if (!pair || !exchangeKeyId) return null;
    const formValue = form.value;
    const exitConfig = this.buildExitConfig(form.get('exitConfig') as FormGroup);
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
        stopLossPrice: formValue.stopLossPrice,
        exitConfig
      }
    );
  }

  private buildExitConfig(exitForm: FormGroup): ExitConfigRequest | undefined {
    if (!exitForm) return undefined;
    const v = exitForm.value;
    if (!v.enableStopLoss && !v.enableTakeProfit && !v.enableTrailingStop) return undefined;

    const config: ExitConfigRequest = {
      enableStopLoss: v.enableStopLoss,
      stopLossType: v.stopLossType,
      stopLossValue: v.stopLossValue ?? 0,
      enableTakeProfit: v.enableTakeProfit,
      takeProfitType: v.takeProfitType,
      takeProfitValue: v.takeProfitValue ?? 0,
      enableTrailingStop: v.enableTrailingStop,
      trailingType: v.trailingType,
      trailingValue: v.trailingValue ?? 0,
      trailingActivation: v.trailingActivation,
      useOco: v.enableStopLoss && v.enableTakeProfit ? v.useOco : false
    };

    if (v.trailingActivation !== TrailingActivationType.IMMEDIATE && v.trailingActivationValue != null) {
      config.trailingActivationValue = v.trailingActivationValue;
    }

    return config;
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
        (form.get('exitConfig') as FormGroup)?.reset({
          ...DEFAULT_EXIT_CONFIG,
          trailingActivationValue: null
        });
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

  private triggerPreview(side: 'BUY' | 'SELL'): void {
    (side === 'BUY' ? this.buyPreviewSubject$ : this.sellPreviewSubject$).next();
  }

  private executePreview(side: 'BUY' | 'SELL'): void {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const quantity = form.get('quantity')?.value;
    if (!quantity || quantity <= 0) return;

    const orderRequest = this.buildPlaceOrderRequest(side);
    if (!orderRequest) return;

    this.previewOrderMutation.mutate(orderRequest, {
      onSuccess: (preview) => {
        (side === 'BUY' ? this.buyOrderPreview : this.sellOrderPreview).set(preview);
        if (preview.supportedOrderTypes) {
          this.supportedOrderTypes.set(preview.supportedOrderTypes);
        }
      },
      onError: () => {
        /* Preview failures are non-critical */
      }
    });
  }

  private applyMarketLimitsValidators(form: FormGroup, limits: MarketLimits) {
    const quantityControl = form.get('quantity');
    if (!quantityControl) return;

    const validators = [Validators.required, Validators.min(limits.minQuantity > 0 ? limits.minQuantity : 0.00000001)];
    if (limits.maxQuantity > 0) {
      validators.push(Validators.max(limits.maxQuantity));
    }
    quantityControl.setValidators(validators);
    quantityControl.updateValueAndValidity({ emitEvent: false });
  }

  private setQuantityPercentage(side: 'BUY' | 'SELL', percentage: number) {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();
    if (!pair) return;

    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    const price = pair.currentPrice || preview?.marketPrice || 0;

    if (side === 'BUY') {
      this.selectedBuyPercentage.set(percentage);
      const available = getAvailableBuyBalance(this.balancesQuery.data(), pair, preview);
      const amountToSpend = available * (percentage / 100);
      form.get('quantity')?.setValue(price > 0 ? amountToSpend / price : 0);
    } else {
      this.selectedSellPercentage.set(percentage);
      const quantity = getAvailableSellBalance(this.balancesQuery.data(), pair) * (percentage / 100);
      form.get('quantity')?.setValue(quantity);
    }
  }
}
