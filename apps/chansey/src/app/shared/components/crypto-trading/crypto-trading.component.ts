import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { MessageService } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { FloatLabel } from 'primeng/floatlabel';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { Subject, takeUntil } from 'rxjs';

import { Exchange, OrderPreview, OrderSide, OrderStatus, OrderType, TickerPair } from '@chansey/api-interfaces';

import { AuthService } from '../../services';
import { Balance, CryptoTradingService } from '../../services/crypto-trading.service';
import { ExchangeService } from '../../services/exchange.service';

@Component({
  selector: 'app-crypto-trading',
  standalone: true,
  imports: [
    CommonModule,
    FloatLabel,
    FormsModule,
    ReactiveFormsModule,
    AvatarModule,
    ButtonModule,
    CardModule,
    InputNumberModule,
    SelectModule,
    SelectButtonModule,
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
  selectedBuyPercentage = signal<number | null>(null);
  selectedSellPercentage = signal<number | null>(null);
  buyOrderPreview = signal<OrderPreview | null>(null);
  sellOrderPreview = signal<OrderPreview | null>(null);

  // Computed symbol for order book query
  selectedSymbol = computed(() => {
    const pairSymbol = this.selectedPairValue();
    const pairs = this.tradingPairsQuery.data();

    if (!pairSymbol || !pairs) {
      return null;
    }

    const foundPair = pairs.find((pair) => pair.symbol.toUpperCase() === pairSymbol.toUpperCase());
    return foundPair?.symbol || null;
  });

  // Forms
  buyOrderForm!: FormGroup;
  sellOrderForm!: FormGroup;

  // Query hooks
  userQuery = this.authService.useUser();
  exchangeQuery = this.exchangeService.useSupportedExchanges();
  tradingPairsQuery = this.tradingService.useTradingPairs(this.selectedExchangeId);
  balancesQuery = this.tradingService.useBalances();
  activeOrdersQuery = this.tradingService.useActiveOrders();
  orderBookQuery = this.tradingService.useOrderBook(this.selectedSymbol, this.selectedExchangeId);

  // Mutations
  createOrderMutation = this.tradingService.useCreateOrder();
  previewOrderMutation = this.tradingService.usePreviewOrder();
  cancelOrderMutation = this.tradingService.useCancelOrder();

  // Computed values
  selectedPair = computed(() => {
    const pairSymbol = this.selectedPairValue();
    const pairs = this.tradingPairsQuery.data();

    if (!pairSymbol || !pairs) {
      console.log('No pair symbol or no pairs data:', { pairSymbol, pairs });
      return null;
    }

    console.log('Looking for pair:', pairSymbol);
    console.log(
      'Available pairs:',
      pairs.map((p) => ({ symbol: p.symbol, upperSymbol: p.symbol.toUpperCase() }))
    );

    // Find pair by comparing uppercase symbols since tradingPairOptions uses toUpperCase()
    const foundPair = pairs.find((pair) => pair.symbol.toUpperCase() === pairSymbol.toUpperCase());
    console.log('Found pair:', foundPair);

    return foundPair || null;
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

  orderTypeOptions = [
    { label: 'Market', value: OrderType.MARKET },
    { label: 'Limit', value: OrderType.LIMIT }
  ];

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
      description: 'One-Cancels-Other: Take profit and stop loss pair, cancels one when the other executes'
    }
  ];

  quickAmountOptions = [
    { label: '25%', value: 25 },
    { label: '50%', value: 50 },
    { label: '75%', value: 75 },
    { label: 'Max', value: 100 }
  ];

  trailingTypeOptions = [
    { label: 'Amount', value: 'amount' },
    { label: 'Percentage', value: 'percentage' }
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
      stopPrice: [null],
      trailingAmount: [null],
      trailingType: ['amount'],
      takeProfitPrice: [null],
      stopLossPrice: [null]
    });

    this.sellOrderForm = this.fb.group({
      type: [OrderType.MARKET, Validators.required],
      quantity: [null, [Validators.required, Validators.min(0.001)]],
      price: [null],
      stopPrice: [null],
      trailingAmount: [null],
      trailingType: ['amount'],
      takeProfitPrice: [null],
      stopLossPrice: [null]
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
        const trailingAmountControl = this.buyOrderForm.get('trailingAmount');
        const takeProfitPriceControl = this.buyOrderForm.get('takeProfitPrice');
        const stopLossPriceControl = this.buyOrderForm.get('stopLossPrice');

        // Reset validators
        priceControl?.clearValidators();
        stopPriceControl?.clearValidators();
        trailingAmountControl?.clearValidators();
        takeProfitPriceControl?.clearValidators();
        stopLossPriceControl?.clearValidators();

        // Set validators based on order type
        if (type === OrderType.LIMIT || type === OrderType.STOP_LIMIT) {
          priceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }
        if (type === OrderType.STOP_LOSS || type === OrderType.STOP_LIMIT) {
          stopPriceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }
        if (type === OrderType.TRAILING_STOP) {
          trailingAmountControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }
        if (type === OrderType.TAKE_PROFIT) {
          takeProfitPriceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }
        if (type === OrderType.OCO) {
          takeProfitPriceControl?.setValidators([Validators.required, Validators.min(0.001)]);
          stopLossPriceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }

        priceControl?.updateValueAndValidity();
        stopPriceControl?.updateValueAndValidity();
        trailingAmountControl?.updateValueAndValidity();
        takeProfitPriceControl?.updateValueAndValidity();
        stopLossPriceControl?.updateValueAndValidity();

        // Preview order when type changes
        this.calculateOrderTotalWithPreview('BUY');
      });

    this.sellOrderForm
      .get('type')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((type) => {
        const priceControl = this.sellOrderForm.get('price');
        const stopPriceControl = this.sellOrderForm.get('stopPrice');
        const trailingAmountControl = this.sellOrderForm.get('trailingAmount');
        const takeProfitPriceControl = this.sellOrderForm.get('takeProfitPrice');
        const stopLossPriceControl = this.sellOrderForm.get('stopLossPrice');

        // Reset validators
        priceControl?.clearValidators();
        stopPriceControl?.clearValidators();
        trailingAmountControl?.clearValidators();
        takeProfitPriceControl?.clearValidators();
        stopLossPriceControl?.clearValidators();

        // Set validators based on order type
        if (type === OrderType.LIMIT || type === OrderType.STOP_LIMIT) {
          priceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }
        if (type === OrderType.STOP_LOSS || type === OrderType.STOP_LIMIT) {
          stopPriceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }
        if (type === OrderType.TRAILING_STOP) {
          trailingAmountControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }
        if (type === OrderType.TAKE_PROFIT) {
          takeProfitPriceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }
        if (type === OrderType.OCO) {
          takeProfitPriceControl?.setValidators([Validators.required, Validators.min(0.001)]);
          stopLossPriceControl?.setValidators([Validators.required, Validators.min(0.001)]);
        }

        priceControl?.updateValueAndValidity();
        stopPriceControl?.updateValueAndValidity();
        trailingAmountControl?.updateValueAndValidity();
        takeProfitPriceControl?.updateValueAndValidity();
        stopLossPriceControl?.updateValueAndValidity();

        // Preview order when type changes
        this.calculateOrderTotalWithPreview('SELL');
      });

    // Preview order when quantity changes
    this.buyOrderForm
      .get('quantity')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.calculateOrderTotalWithPreview('BUY');
      });

    this.sellOrderForm
      .get('quantity')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.calculateOrderTotalWithPreview('SELL');
      });

    // Preview order when price changes (for limit orders)
    this.buyOrderForm
      .get('price')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.calculateOrderTotalWithPreview('BUY');
      });

    this.sellOrderForm
      .get('price')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.calculateOrderTotalWithPreview('SELL');
      });
  }

  onPairChange(event: { value: string }) {
    const symbol = event.value;
    this.selectedPairValue.set(symbol);

    // Use case-insensitive matching to find the pair
    const pair = this.tradingPairsQuery.data()?.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase());
    if (pair) {
      this.tradingService.setSelectedPair(pair);
    }
  }

  onSubmitOrder(side: 'BUY' | 'SELL') {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();
    const exchangeId = this.selectedExchangeId();

    if (!form.valid || !pair || !exchangeId) return;

    const formValue = form.value;
    const userExchanges = this.userQuery.data()?.exchanges;
    const userExchange = userExchanges?.find((ue: any) => ue.exchangeId === exchangeId);

    if (!userExchange?.id) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No exchange key found for selected exchange'
      });
      return;
    }

    const orderData: any = {
      exchangeKeyId: userExchange.id,
      symbol: pair.symbol,
      orderType: formValue.type,
      side: side === 'BUY' ? OrderSide.BUY : OrderSide.SELL,
      quantity: formValue.quantity
    };

    // Add conditional fields based on order type
    if (formValue.price) {
      orderData.price = formValue.price;
    }
    if (formValue.stopPrice) {
      orderData.stopPrice = formValue.stopPrice;
    }
    if (formValue.trailingAmount) {
      orderData.trailingAmount = formValue.trailingAmount;
      orderData.trailingType = formValue.trailingType;
    }
    if (formValue.takeProfitPrice) {
      orderData.takeProfitPrice = formValue.takeProfitPrice;
    }
    if (formValue.stopLossPrice) {
      orderData.stopLossPrice = formValue.stopLossPrice;
    }

    this.createOrderMutation.mutate(orderData, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: `${side} order placed successfully`
        });
        form.reset({ type: OrderType.MARKET, trailingType: 'amount' });
      },
      onError: (error: Error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
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
    // this.activeOrdersQuery.refetch();
  }

  /**
   * Calculate order total and fees using real-time exchange data
   */
  calculateOrderTotalWithPreview(side: 'BUY' | 'SELL'): void {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();
    console.log(pair);

    if (!pair || !form.valid || !pair.baseAsset?.id) return;

    const quantity = form.get('quantity')?.value || 0;
    const orderType = form.get('type')?.value;
    const price = form.get('price')?.value;

    if (quantity <= 0) return;

    const orderData = {
      baseCoinId: pair.baseAsset.id,
      quoteCoinId: pair.quoteAsset?.id,
      quantity: quantity.toString(),
      price: price?.toString(),
      type: orderType,
      exchangeId: this.selectedExchangeId() || pair.exchange?.id,
      side: side === 'BUY' ? OrderSide.BUY : OrderSide.SELL
    };

    // Preview the order to get real-time fees and calculations
    this.previewOrderMutation.mutate(orderData, {
      onSuccess: (preview) => {
        // Store the preview data for display in the UI
        if (side === 'BUY') {
          this.buyOrderPreview.set(preview);
        } else {
          this.sellOrderPreview.set(preview);
        }
      },
      onError: (error: any) => {
        console.error('Order preview failed:', error);
      }
    });
  }

  /**
   * Get order total from preview or calculate fallback
   */
  calculateOrderTotal(side: 'BUY' | 'SELL'): number {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    if (preview) {
      return preview.estimatedCost;
    }

    // Fallback calculation
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();

    if (!pair || !form.valid) return 0;

    const quantity = form.get('quantity')?.value || 0;
    const orderType = form.get('type')?.value;

    let price: number;
    if (orderType === OrderType.MARKET) {
      price = pair.currentPrice || 0;
    } else {
      price = form.get('price')?.value || pair.currentPrice || 0;
    }

    return quantity * price;
  }
  calculateOrderFees(side: 'BUY' | 'SELL'): number {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    if (preview) {
      return preview.estimatedFee;
    }

    // Fallback calculation
    const total = this.calculateOrderTotal(side);
    const feeRate = this.getTradingFeeRate() / 100; // Convert percentage to decimal
    return total * feeRate;
  }

  /**
   * Calculate the total cost including fees for a buy order
   */
  calculateBuyOrderTotalWithFees(): number {
    const preview = this.buyOrderPreview();
    if (preview) {
      return preview.totalRequired;
    }

    // Fallback calculation
    const orderTotal = this.calculateOrderTotal('BUY');
    const fees = this.calculateOrderFees('BUY');
    return orderTotal + fees;
  }

  /**
   * Calculate the net amount received after fees for a sell order
   */
  calculateSellOrderNetAmount(): number {
    const preview = this.sellOrderPreview();
    if (preview) {
      // For sell orders, it's total - fees
      return preview.estimatedCost - preview.estimatedFee;
    }

    // Fallback calculation
    const orderTotal = this.calculateOrderTotal('SELL');
    const fees = this.calculateOrderFees('SELL');
    return orderTotal - fees;
  }

  getBuyBalance(): Balance | undefined {
    const pair = this.selectedPair();
    console.log('Selected pair for buy balance:', pair);
    const balances = this.balancesQuery.data();
    console.log('Available balances:', balances);

    if (!pair || !balances) return undefined;

    return balances.find((b) => b.coin.id === pair.quoteAsset?.id);
  }

  getSellBalance(): Balance | undefined {
    const pair = this.selectedPair();
    const balances = this.balancesQuery.data();

    if (!pair || !balances) return undefined;

    return balances.find((b) => b.coin.id === pair.baseAsset?.id);
  }

  /**
   * Get available balance for buying, accounting for trading fees
   */
  getAvailableBuyBalance(): number {
    const balance = this.getBuyBalance();
    const pair = this.selectedPair();

    if (!balance || !pair) return 0;

    const feeRate = this.getTradingFeeRate() / 100; // Convert percentage to decimal
    const totalCost = balance.available;

    // Account for fees when calculating how much we can actually spend
    // If we have $100 and fee is 0.1%, we can only spend ~$99.90 worth
    return totalCost * (1 - feeRate);
  }

  /**
   * Get available balance for selling, accounting for trading fees
   */
  getAvailableSellBalance(): number {
    const balance = this.getSellBalance();

    if (!balance) return 0;

    // For selling, we can sell the full amount but need to account for fees in the received amount
    return balance.available;
  }

  /**
   * Calculate the actual quantity that can be bought with available balance including fees
   */
  calculateMaxBuyQuantityWithFees(): number {
    const availableBalance = this.getAvailableBuyBalance();
    const pair = this.selectedPair();

    if (!pair || !pair.currentPrice || availableBalance <= 0) return 0;

    // Calculate max quantity we can buy with available balance after fees
    return availableBalance / pair.currentPrice;
  }

  /**
   * Calculate the net amount received after selling, accounting for fees
   */
  calculateNetSellAmount(quantity: number): number {
    const pair = this.selectedPair();

    if (!pair || !pair.currentPrice) return 0;

    const grossAmount = quantity * pair.currentPrice;
    const feeRate = this.getTradingFeeRate() / 100;
    const fees = grossAmount * feeRate;

    return grossAmount - fees;
  }

  getTopBids() {
    const orderBook = this.orderBookQuery.data();
    return orderBook?.bids.slice(0, 5) || [];
  }

  getTopAsks() {
    const orderBook = this.orderBookQuery.data();
    return orderBook?.asks.slice(0, 5) || [];
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
    const pair = this.selectedPair();

    if (!pair) return;

    // Update the selected percentage signal
    if (side === 'BUY') {
      this.selectedBuyPercentage.set(percentage);
    } else {
      this.selectedSellPercentage.set(percentage);
    }

    let quantity: number;
    if (side === 'BUY') {
      // For buying, use available balance after fees
      const availableBalance = this.getAvailableBuyBalance();
      const amountToSpend = availableBalance * (percentage / 100);
      const currentPrice = pair.currentPrice || 0;
      quantity = currentPrice > 0 ? amountToSpend / currentPrice : 0;
    } else {
      // For selling, use available sell balance
      const availableBalance = this.getAvailableSellBalance();
      quantity = availableBalance * (percentage / 100);
    }

    form.get('quantity')?.setValue(quantity);
  }

  onBuyPercentageChange(percentage: number | null) {
    if (percentage !== null) {
      this.setQuantityPercentage('BUY', percentage);
    }
  }

  onSellPercentageChange(percentage: number | null) {
    if (percentage !== null) {
      this.setQuantityPercentage('SELL', percentage);
    }
  }

  calculateMaxBuyQuantity(): number {
    // Use the new fee-aware calculation
    return this.calculateMaxBuyQuantityWithFees();
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

  // Order type field visibility helpers
  shouldShowPriceField(form: FormGroup): boolean {
    const type = form.get('type')?.value;
    return type === OrderType.LIMIT || type === OrderType.STOP_LIMIT;
  }

  shouldShowStopPriceField(form: FormGroup): boolean {
    const type = form.get('type')?.value;
    return type === OrderType.STOP_LOSS || type === OrderType.STOP_LIMIT;
  }

  shouldShowTrailingFields(form: FormGroup): boolean {
    const type = form.get('type')?.value;
    return type === OrderType.TRAILING_STOP;
  }

  shouldShowTakeProfitField(form: FormGroup): boolean {
    const type = form.get('type')?.value;
    return type === OrderType.TAKE_PROFIT || type === OrderType.OCO;
  }

  shouldShowStopLossField(form: FormGroup): boolean {
    const type = form.get('type')?.value;
    return type === OrderType.OCO;
  }

  // Validation helper methods
  isFieldInvalid(form: FormGroup, fieldName: string): boolean {
    const field = form.get(fieldName);
    return !!field && field.invalid && (field.dirty || field.touched);
  }

  getFieldError(form: FormGroup, fieldName: string): string {
    const field = form.get(fieldName);
    if (!field || !field.errors) return '';

    if (field.errors['required']) {
      return 'This field is required';
    }
    if (field.errors['min']) {
      return `Minimum value is ${field.errors['min'].min}`;
    }
    return 'Invalid value';
  }
}
