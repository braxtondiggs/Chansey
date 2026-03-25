import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';

import { ConfirmationService, MessageService } from 'primeng/api';
import { of } from 'rxjs';

import { OrderSide, OrderStatus, OrderType, TrailingType } from '@chansey/api-interfaces';

import { CryptoTradingComponent } from './crypto-trading.component';
import {
  calculateBuyOrderTotalWithFees,
  calculateMaxBuyQuantity,
  calculateOrderFees,
  calculateOrderTotal,
  calculateSellOrderNetAmount,
  findBalance,
  getAvailableBuyBalance,
  getAvailableSellBalance,
  getFeeRate,
  getStatusClass
} from './crypto-trading.utils';

import { AuthService, LayoutService } from '../../services';
import { ExchangeService } from '../../services/exchange.service';
import {
  DEFAULT_FEE_RATE,
  TradingMutationService,
  TradingQueryService,
  TradingStateService
} from '../../services/trading';

function createMockQueryResult<T>(initial: T) {
  return {
    data: signal(initial) as WritableSignal<T>,
    isPending: signal(false),
    isLoading: signal(false),
    isError: signal(false),
    error: signal(null),
    refetch: jest.fn(),
    status: signal('success')
  };
}

function createMockMutationResult() {
  return {
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: signal(false),
    isError: signal(false),
    error: signal(null),
    status: signal('idle'),
    reset: jest.fn()
  };
}

// Create stable mock result objects so the component's field initializers
// capture references we can later mutate in tests.
const tradingPairsResult = createMockQueryResult<any[]>([]);
const balancesResult = createMockQueryResult<any[]>([]);
const activeOrdersResult = createMockQueryResult<any[]>([]);
const orderBookResult = createMockQueryResult<any>(null);
const userResult = createMockQueryResult<any>(null);
const exchangesResult = createMockQueryResult<any[]>([]);

const createOrderResult = createMockMutationResult();
const previewOrderResult = createMockMutationResult();
const cancelOrderResult = createMockMutationResult();

const mockTradingQueryService = {
  useTradingPairs: jest.fn(() => tradingPairsResult),
  useBalances: jest.fn(() => balancesResult),
  useActiveOrders: jest.fn(() => activeOrdersResult),
  useOrderBook: jest.fn(() => orderBookResult)
};

const mockTradingMutationService = {
  useCreateOrder: jest.fn(() => createOrderResult),
  usePreviewOrder: jest.fn(() => previewOrderResult),
  useCancelOrder: jest.fn(() => cancelOrderResult)
};

const mockTradingStateService = {
  setSelectedPair: jest.fn(),
  getSelectedPair: jest.fn(() => null),
  selectedPair$: of(null)
};

const mockAuthService = {
  useUser: jest.fn(() => userResult)
};

const mockExchangeService = {
  useSupportedExchanges: jest.fn(() => exchangesResult)
};

const mockMessageService = {
  add: jest.fn()
};

const mockConfirmationService = {
  confirm: jest.fn((config: { accept?: () => void }) => {
    // Auto-accept confirmation dialogs in tests
    config.accept?.();
  }),
  requireConfirmation$: { subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })) },
  accept: jest.fn(),
  onClose: { subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })) }
};

const mockRouter = {
  navigate: jest.fn()
};

const mockLayoutService = {
  updateLayoutState: jest.fn()
};

const MOCK_PAIR = {
  symbol: 'btc/usd',
  baseAsset: { id: 'btc-id', symbol: 'btc' },
  quoteAsset: { id: 'usd-id', symbol: 'usd' },
  currentPrice: 50000,
  spreadPercentage: 0
};

function selectPair(component: CryptoTradingComponent, pair = MOCK_PAIR) {
  tradingPairsResult.data.set([pair]);
  component.selectedPairValue.set(pair.symbol.toUpperCase());
}

function selectExchangeWithKey(component: CryptoTradingComponent) {
  exchangesResult.data.set([{ id: 'ex-1', name: 'Binance', image: 'binance.png', tickerPairsCount: 100 }]);
  userResult.data.set({ exchanges: [{ id: 'key-1', exchangeId: 'ex-1', isActive: true }] });
  component.selectedExchangeId.set('ex-1');
}

describe('CryptoTradingComponent', () => {
  let component: CryptoTradingComponent;
  let fixture: ComponentFixture<CryptoTradingComponent>;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset signal values to defaults
    tradingPairsResult.data.set([]);
    balancesResult.data.set([]);
    activeOrdersResult.data.set([]);
    orderBookResult.data.set(null);
    userResult.data.set(null);
    exchangesResult.data.set([]);

    await TestBed.configureTestingModule({
      imports: [CryptoTradingComponent],
      providers: [
        FormBuilder,
        { provide: TradingQueryService, useValue: mockTradingQueryService },
        { provide: TradingMutationService, useValue: mockTradingMutationService },
        { provide: TradingStateService, useValue: mockTradingStateService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ExchangeService, useValue: mockExchangeService },
        { provide: MessageService, useValue: mockMessageService },
        { provide: ConfirmationService, useValue: mockConfirmationService },
        { provide: Router, useValue: mockRouter },
        { provide: LayoutService, useValue: mockLayoutService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CryptoTradingComponent);
    component = fixture.componentInstance;
  });

  describe('selectedSymbol', () => {
    it('should return null when no pair is selected', () => {
      expect(component.selectedSymbol()).toBeNull();
    });

    it('should return uppercase symbol via case-insensitive match', () => {
      selectPair(component);
      expect(component.selectedSymbol()).toBe('BTC/USD');
    });

    it('should return null when selectedPairValue does not match any pair', () => {
      tradingPairsResult.data.set([MOCK_PAIR]);
      component.selectedPairValue.set('ETH/USD');
      expect(component.selectedSymbol()).toBeNull();
    });
  });

  describe('calculateOrderTotal (utility)', () => {
    beforeEach(() => {
      component.ngOnInit();
    });

    it('should return 0 when no pair is selected and no preview', () => {
      expect(calculateOrderTotal(component.buyOrderForm, null, null)).toBe(0);
    });

    it('should calculate total from quantity and market price', () => {
      selectPair(component);
      component.buyOrderForm.get('quantity')?.setValue(2);
      component.buyOrderForm.get('type')?.setValue(OrderType.MARKET);

      expect(calculateOrderTotal(component.buyOrderForm, component.selectedPair(), null)).toBe(100000);
    });

    it('should use limit price for limit orders', () => {
      selectPair(component);
      component.buyOrderForm.get('quantity')?.setValue(1);
      component.buyOrderForm.get('type')?.setValue(OrderType.LIMIT);
      component.buyOrderForm.get('price')?.setValue(45000);

      expect(calculateOrderTotal(component.buyOrderForm, component.selectedPair(), null)).toBe(45000);
    });

    it('should prefer preview estimatedCost over calculated value', () => {
      selectPair(component);
      const preview = { estimatedCost: 99500, estimatedFee: 100, totalRequired: 99600 } as any;
      component.buyOrderPreview.set(preview);
      component.buyOrderForm.get('quantity')?.setValue(2);

      expect(calculateOrderTotal(component.buyOrderForm, component.selectedPair(), preview)).toBe(99500);
    });
  });

  describe('calculateOrderFees (utility)', () => {
    beforeEach(() => {
      component.ngOnInit();
    });

    it('should return preview fee when preview exists', () => {
      const preview = { estimatedCost: 100000, estimatedFee: 150, totalRequired: 100150 } as any;
      expect(calculateOrderFees(component.buyOrderForm, null, preview)).toBe(150);
    });

    it('should fallback to DEFAULT_FEE_RATE * total when no preview', () => {
      selectPair(component);
      component.buyOrderForm.get('quantity')?.setValue(2);
      component.buyOrderForm.get('type')?.setValue(OrderType.MARKET);

      expect(calculateOrderFees(component.buyOrderForm, component.selectedPair(), null)).toBe(
        100000 * DEFAULT_FEE_RATE
      );
    });
  });

  describe('calculateBuyOrderTotalWithFees (utility)', () => {
    beforeEach(() => {
      component.ngOnInit();
    });

    it('should return preview totalRequired when preview exists', () => {
      const preview = { estimatedCost: 100000, estimatedFee: 100, totalRequired: 100100 } as any;
      expect(calculateBuyOrderTotalWithFees(component.buyOrderForm, null, preview)).toBe(100100);
    });

    it('should fallback to total + fees when no preview', () => {
      selectPair(component);
      component.buyOrderForm.get('quantity')?.setValue(1);
      component.buyOrderForm.get('type')?.setValue(OrderType.MARKET);

      const pair = component.selectedPair();
      const total = calculateOrderTotal(component.buyOrderForm, pair, null);
      const fees = calculateOrderFees(component.buyOrderForm, pair, null);
      expect(calculateBuyOrderTotalWithFees(component.buyOrderForm, pair, null)).toBe(total + fees);
    });
  });

  describe('calculateSellOrderNetAmount (utility)', () => {
    beforeEach(() => {
      component.ngOnInit();
    });

    it('should return estimatedCost minus fee when preview exists', () => {
      const preview = { estimatedCost: 90000, estimatedFee: 90, totalRequired: 0 } as any;
      expect(calculateSellOrderNetAmount(component.sellOrderForm, null, preview)).toBe(89910);
    });

    it('should fallback to total - fees when no preview', () => {
      selectPair(component);
      component.sellOrderForm.get('quantity')?.setValue(1);
      component.sellOrderForm.get('type')?.setValue(OrderType.MARKET);

      const pair = component.selectedPair();
      const total = calculateOrderTotal(component.sellOrderForm, pair, null);
      const fees = calculateOrderFees(component.sellOrderForm, pair, null);
      expect(calculateSellOrderNetAmount(component.sellOrderForm, pair, null)).toBe(total - fees);
    });
  });

  describe('onExchangeChange', () => {
    it('should set selectedExchangeId and reset pair + previews', () => {
      component.selectedPairValue.set('BTC/USD');
      component.buyOrderPreview.set({ estimatedCost: 100 } as any);
      component.sellOrderPreview.set({ estimatedCost: 200 } as any);

      component.onExchangeChange({ value: 'exchange-123' });

      expect(component.selectedExchangeId()).toBe('exchange-123');
      expect(component.selectedPairValue()).toBeNull();
      expect(component.buyOrderPreview()).toBeNull();
      expect(component.sellOrderPreview()).toBeNull();
    });

    it('should show info toast', () => {
      component.onExchangeChange({ value: 'exchange-123' });

      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'info', summary: 'Exchange Selected' })
      );
    });
  });

  describe('onPairChange', () => {
    it('should update selectedPairValue and notify state service', () => {
      tradingPairsResult.data.set([MOCK_PAIR]);
      component.onPairChange({ value: 'BTC/USD' });

      expect(component.selectedPairValue()).toBe('BTC/USD');
      expect(mockTradingStateService.setSelectedPair).toHaveBeenCalledWith(MOCK_PAIR);
    });

    it('should not call setSelectedPair when pair is not found', () => {
      tradingPairsResult.data.set([MOCK_PAIR]);
      component.onPairChange({ value: 'ETH/BTC' });

      expect(component.selectedPairValue()).toBe('ETH/BTC');
      expect(mockTradingStateService.setSelectedPair).not.toHaveBeenCalled();
    });
  });

  describe('onSubmitOrder', () => {
    beforeEach(() => {
      component.ngOnInit();
      selectPair(component);
      selectExchangeWithKey(component);
    });

    it('should show warning when form is invalid', () => {
      // quantity is required and null by default
      component.onSubmitOrder('BUY');

      expect(createOrderResult.mutate).not.toHaveBeenCalled();
      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'warn', summary: 'Validation Error' })
      );
    });

    it('should show error when no exchange/pair is selected', () => {
      component.buyOrderForm.get('quantity')?.setValue(1);
      component.selectedPairValue.set(null); // no pair selected

      component.onSubmitOrder('BUY');

      expect(createOrderResult.mutate).not.toHaveBeenCalled();
      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', summary: 'Error' })
      );
    });

    it('should call createOrderMutation.mutate with correct request', () => {
      component.buyOrderForm.get('quantity')?.setValue(1.5);
      component.buyOrderForm.get('type')?.setValue(OrderType.MARKET);

      component.onSubmitOrder('BUY');

      expect(createOrderResult.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          exchangeKeyId: 'key-1',
          symbol: 'BTC/USD',
          side: OrderSide.BUY,
          orderType: OrderType.MARKET,
          quantity: 1.5
        }),
        expect.any(Object)
      );
    });

    it('should include price for limit orders', () => {
      component.buyOrderForm.get('type')?.setValue(OrderType.LIMIT);
      component.buyOrderForm.get('quantity')?.setValue(1);
      component.buyOrderForm.get('price')?.setValue(48000);

      component.onSubmitOrder('BUY');

      expect(createOrderResult.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ price: 48000, orderType: OrderType.LIMIT }),
        expect.any(Object)
      );
    });

    it('should reset form and preview on success callback', () => {
      component.buyOrderForm.get('quantity')?.setValue(1);
      component.buyOrderPreview.set({ estimatedCost: 50000 } as any);

      component.onSubmitOrder('BUY');

      // Extract and invoke the onSuccess callback
      const callArgs = createOrderResult.mutate.mock.calls[0];
      const callbacks = callArgs[1];
      callbacks.onSuccess();

      expect(component.buyOrderPreview()).toBeNull();
      expect(component.selectedBuyPercentage()).toBeNull();
      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success', summary: 'Order Placed' })
      );
    });

    it('should show error toast on failure callback', () => {
      component.buyOrderForm.get('quantity')?.setValue(1);
      component.onSubmitOrder('BUY');

      const callbacks = createOrderResult.mutate.mock.calls[0][1];
      callbacks.onError(new Error('Insufficient funds'));

      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: 'Insufficient funds' })
      );
    });

    it('should build sell order request correctly', () => {
      component.sellOrderForm.get('quantity')?.setValue(0.5);
      component.sellOrderForm.get('type')?.setValue(OrderType.MARKET);

      component.onSubmitOrder('SELL');

      expect(createOrderResult.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ side: OrderSide.SELL, quantity: 0.5 }),
        expect.any(Object)
      );
    });
  });

  describe('cancelOrder', () => {
    it('should call cancelOrderMutation.mutate with orderId', () => {
      component.cancelOrder('order-abc');

      expect(cancelOrderResult.mutate).toHaveBeenCalledWith('order-abc', expect.any(Object));
    });

    it('should show success toast on cancel success', () => {
      component.cancelOrder('order-abc');

      const callbacks = cancelOrderResult.mutate.mock.calls[0][1];
      callbacks.onSuccess();

      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success', summary: 'Order Cancelled' })
      );
    });

    it('should show error toast on cancel failure', () => {
      component.cancelOrder('order-abc');

      const callbacks = cancelOrderResult.mutate.mock.calls[0][1];
      callbacks.onError(new Error('Not found'));

      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: 'Not found' })
      );
    });
  });

  describe('getStatusClass (utility)', () => {
    it.each([
      [OrderStatus.NEW, 'bg-blue-100'],
      [OrderStatus.FILLED, 'bg-green-100'],
      [OrderStatus.CANCELED, 'bg-red-100'],
      [OrderStatus.PARTIALLY_FILLED, 'bg-yellow-100'],
      [OrderStatus.EXPIRED, 'bg-gray-100']
    ])('should return correct class for %s', (status, expected) => {
      expect(getStatusClass(status)).toContain(expected);
    });

    it('should return default class for unknown status', () => {
      expect(getStatusClass('UNKNOWN' as any)).toBe('bg-gray-100 text-gray-800');
    });
  });

  describe('balance helpers (utility)', () => {
    beforeEach(() => {
      selectPair(component);
    });

    it('findBalance should find quote asset balance (BUY)', () => {
      const balances = [{ coin: { id: 'usd-id' }, available: 10000 }] as any;
      expect(findBalance(balances, component.selectedPair(), 'BUY')).toEqual({
        coin: { id: 'usd-id' },
        available: 10000
      });
    });

    it('findBalance should find base asset balance (SELL)', () => {
      const balances = [{ coin: { id: 'btc-id' }, available: 2.5 }] as any;
      expect(findBalance(balances, component.selectedPair(), 'SELL')).toEqual({
        coin: { id: 'btc-id' },
        available: 2.5
      });
    });

    it('findBalance should return undefined when no matching balance', () => {
      const balances = [{ coin: { id: 'other' }, available: 100 }] as any;
      expect(findBalance(balances, component.selectedPair(), 'BUY')).toBeUndefined();
    });

    it('getAvailableBuyBalance should deduct fee rate from available balance', () => {
      const balances = [{ coin: { id: 'usd-id' }, available: 10000 }] as any;
      const feeRate = getFeeRate(null);
      expect(getAvailableBuyBalance(balances, component.selectedPair(), null)).toBe(10000 * (1 - feeRate));
    });

    it('getAvailableSellBalance should return full available balance', () => {
      const balances = [{ coin: { id: 'btc-id' }, available: 2.5 }] as any;
      expect(getAvailableSellBalance(balances, component.selectedPair())).toBe(2.5);
    });

    it('getAvailableBuyBalance should return 0 when no balance exists', () => {
      expect(getAvailableBuyBalance(undefined, component.selectedPair(), null)).toBe(0);
    });
  });

  describe('calculateMaxBuyQuantity (utility)', () => {
    beforeEach(() => {
      selectPair(component);
    });

    it('should return available balance divided by price', () => {
      const balances = [{ coin: { id: 'usd-id' }, available: 10000 }] as any;
      const pair = component.selectedPair();
      const available = getAvailableBuyBalance(balances, pair, null);
      expect(calculateMaxBuyQuantity(balances, pair, null)).toBe(available / 50000);
    });

    it('should return 0 when no balance', () => {
      expect(calculateMaxBuyQuantity(undefined, component.selectedPair(), null)).toBe(0);
    });

    it('should return 0 when price is 0', () => {
      tradingPairsResult.data.set([{ ...MOCK_PAIR, currentPrice: 0 }]);
      const balances = [{ coin: { id: 'usd-id' }, available: 10000 }] as any;
      expect(calculateMaxBuyQuantity(balances, component.selectedPair(), null)).toBe(0);
    });
  });

  describe('setQuantityPercentage (via onBuyPercentageChange/onSellPercentageChange)', () => {
    beforeEach(() => {
      component.ngOnInit();
      selectPair(component);
    });

    it('should set buy quantity based on percentage of available balance', () => {
      balancesResult.data.set([{ coin: { id: 'usd-id' }, available: 10000 }]);
      component.onBuyPercentageChange(50);

      expect(component.selectedBuyPercentage()).toBe(50);
      const qty = component.buyOrderForm.get('quantity')?.value;
      expect(qty).toBeGreaterThan(0);
    });

    it('should set sell quantity based on percentage of available balance', () => {
      balancesResult.data.set([{ coin: { id: 'btc-id' }, available: 2 }]);
      component.onSellPercentageChange(100);

      expect(component.selectedSellPercentage()).toBe(100);
      expect(component.sellOrderForm.get('quantity')?.value).toBe(2);
    });

    it('should not set quantity when no pair is selected', () => {
      component.selectedPairValue.set(null);
      component.onBuyPercentageChange(50);

      expect(component.buyOrderForm.get('quantity')?.value).toBeNull();
    });
  });

  describe('selectedExchangeKeyId', () => {
    it('should return null when no exchange is selected', () => {
      expect(component.selectedExchangeKeyId()).toBeNull();
    });

    it('should return the exchange key id when exchange and user data match', () => {
      selectExchangeWithKey(component);
      expect(component.selectedExchangeKeyId()).toBe('key-1');
    });

    it('should return null when user has no matching exchange key', () => {
      userResult.data.set({ exchanges: [{ id: 'key-1', exchangeId: 'other-ex', isActive: true }] });
      component.selectedExchangeId.set('ex-1');
      expect(component.selectedExchangeKeyId()).toBeNull();
    });
  });

  describe('exchangeOptions', () => {
    it('should map exchanges with connected status from user keys', () => {
      exchangesResult.data.set([{ id: 'ex-1', name: 'Binance', image: 'b.png', tickerPairsCount: 50 }]);
      userResult.data.set({ exchanges: [{ id: 'key-1', exchangeId: 'ex-1', isActive: true }] });

      const options = component.exchangeOptions();
      expect(options).toEqual([
        expect.objectContaining({ label: 'Binance', value: 'ex-1', status: 'connected', pairCount: 50 })
      ]);
    });

    it('should mark exchange as disconnected when user has no active key', () => {
      exchangesResult.data.set([{ id: 'ex-1', name: 'Binance', image: 'b.png', tickerPairsCount: 50 }]);
      userResult.data.set({ exchanges: [] });

      const options = component.exchangeOptions();
      expect(options?.[0]?.status).toBe('disconnected');
    });
  });

  describe('order book data', () => {
    it('should expose orderBookQuery data for child component', () => {
      expect(component.orderBookQuery.data()).toBeNull();

      const entries = Array.from({ length: 10 }, (_, i) => ({ price: 50000 + i * 100, amount: 1 }));
      orderBookResult.data.set({ bids: entries, asks: entries });
      expect(component.orderBookQuery.data()?.bids).toHaveLength(10);
    });
  });

  describe('hasSufficientBalance (computed signal)', () => {
    it('should return true when no preview exists (optimistic default)', () => {
      expect(component.buyHasSufficientBalance()).toBe(true);
    });

    it('should return false when preview indicates insufficient balance', () => {
      component.buyOrderPreview.set({ hasSufficientBalance: false } as any);
      expect(component.buyHasSufficientBalance()).toBe(false);
    });
  });

  describe('getPreviewWarnings', () => {
    it('should return empty array when no preview', () => {
      expect(component.getPreviewWarnings('BUY')).toEqual([]);
    });

    it('should return warnings from preview', () => {
      component.sellOrderPreview.set({ warnings: ['Low liquidity', 'High slippage'] } as any);
      expect(component.getPreviewWarnings('SELL')).toEqual(['Low liquidity', 'High slippage']);
    });
  });

  describe('getSelectedExchangeName', () => {
    it('should return exchange label when selected', () => {
      exchangesResult.data.set([{ id: 'ex-1', name: 'Binance', image: 'b.png', tickerPairsCount: 50 }]);
      userResult.data.set({ exchanges: [] });
      component.selectedExchangeId.set('ex-1');

      expect(component.getSelectedExchangeName()).toBe('Binance');
    });

    it('should return "No Exchange" when none selected', () => {
      expect(component.getSelectedExchangeName()).toBe('No Exchange');
    });
  });

  describe('isExchangeDisconnected', () => {
    it('should return false when no exchange is selected', () => {
      expect(component.isExchangeDisconnected()).toBe(false);
    });

    it('should return true when exchange is selected but has no active key', () => {
      exchangesResult.data.set([{ id: 'ex-1', name: 'Binance', image: 'b.png', tickerPairsCount: 50 }]);
      userResult.data.set({ exchanges: [] });
      component.selectedExchangeId.set('ex-1');

      expect(component.isExchangeDisconnected()).toBe(true);
    });

    it('should return true when exchange key exists but is inactive', () => {
      exchangesResult.data.set([{ id: 'ex-1', name: 'Binance', image: 'b.png', tickerPairsCount: 50 }]);
      userResult.data.set({ exchanges: [{ id: 'key-1', exchangeId: 'ex-1', isActive: false }] });
      component.selectedExchangeId.set('ex-1');

      expect(component.isExchangeDisconnected()).toBe(true);
    });

    it('should return false when exchange is selected with active key', () => {
      selectExchangeWithKey(component);
      expect(component.isExchangeDisconnected()).toBe(false);
    });
  });

  describe('navigateToExchangeSetup', () => {
    it('should close right menu and navigate to settings with trading tab and exchanges fragment', () => {
      component.navigateToExchangeSetup();

      expect(mockLayoutService.updateLayoutState).toHaveBeenCalledWith({ rightMenuVisible: false });
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/app/settings'], {
        queryParams: { tab: 'trading' },
        fragment: 'exchanges'
      });
    });

    it('should include exchange slug in query params when an exchange is selected', () => {
      exchangesResult.data.set([
        { id: 'ex-1', name: 'Binance', slug: 'binance-us', image: 'b.png', tickerPairsCount: 50 },
        { id: 'ex-2', name: 'Kraken', slug: 'kraken', image: 'k.png', tickerPairsCount: 30 }
      ]);
      component.selectedExchangeId.set('ex-2');

      component.navigateToExchangeSetup();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/app/settings'], {
        queryParams: { tab: 'trading', exchange: 'kraken' },
        fragment: 'exchanges'
      });
    });
  });

  describe('updateFormValidators (via order type change)', () => {
    beforeEach(() => {
      component.ngOnInit();
    });

    it.each([
      [OrderType.LIMIT, 'price'],
      [OrderType.STOP_LOSS, 'stopPrice'],
      [OrderType.STOP_LIMIT, 'price'],
      [OrderType.STOP_LIMIT, 'stopPrice'],
      [OrderType.TRAILING_STOP, 'trailingAmount'],
      [OrderType.TAKE_PROFIT, 'takeProfitPrice']
    ])('should require %s control for %s order type', (orderType, controlName) => {
      component.buyOrderForm.get('type')?.setValue(orderType);

      const control = component.buyOrderForm.get(controlName);
      control?.setValue(null);
      control?.updateValueAndValidity();

      expect(control?.hasError('required')).toBe(true);
    });

    it('should require both takeProfitPrice and stopLossPrice for OCO orders', () => {
      component.buyOrderForm.get('type')?.setValue(OrderType.OCO);

      const tp = component.buyOrderForm.get('takeProfitPrice');
      const sl = component.buyOrderForm.get('stopLossPrice');
      tp?.setValue(null);
      sl?.setValue(null);
      tp?.updateValueAndValidity();
      sl?.updateValueAndValidity();

      expect(tp?.hasError('required')).toBe(true);
      expect(sl?.hasError('required')).toBe(true);
    });

    it('should clear validators when switching back to MARKET', () => {
      component.buyOrderForm.get('type')?.setValue(OrderType.LIMIT);
      component.buyOrderForm.get('type')?.setValue(OrderType.MARKET);

      const priceCtrl = component.buyOrderForm.get('price');
      priceCtrl?.setValue(null);
      priceCtrl?.updateValueAndValidity();

      expect(priceCtrl?.hasError('required')).toBe(false);
    });
  });

  describe('buildOrderRequest (via onSubmitOrder)', () => {
    beforeEach(() => {
      component.ngOnInit();
      selectPair(component);
      selectExchangeWithKey(component);
    });

    it('should include stopPrice for stop-loss orders', () => {
      component.buyOrderForm.get('type')?.setValue(OrderType.STOP_LOSS);
      component.buyOrderForm.get('quantity')?.setValue(1);
      component.buyOrderForm.get('stopPrice')?.setValue(45000);

      component.onSubmitOrder('BUY');

      expect(createOrderResult.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ orderType: OrderType.STOP_LOSS, stopPrice: 45000 }),
        expect.any(Object)
      );
    });

    it('should include trailingAmount and trailingType for trailing stop orders', () => {
      component.buyOrderForm.get('type')?.setValue(OrderType.TRAILING_STOP);
      component.buyOrderForm.get('quantity')?.setValue(1);
      component.buyOrderForm.get('trailingAmount')?.setValue(500);
      component.buyOrderForm.get('trailingType')?.setValue(TrailingType.AMOUNT);

      component.onSubmitOrder('BUY');

      expect(createOrderResult.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          orderType: OrderType.TRAILING_STOP,
          trailingAmount: 500,
          trailingType: TrailingType.AMOUNT
        }),
        expect.any(Object)
      );
    });

    it('should include takeProfitPrice and stopLossPrice for OCO orders', () => {
      component.buyOrderForm.get('type')?.setValue(OrderType.OCO);
      component.buyOrderForm.get('quantity')?.setValue(1);
      component.buyOrderForm.get('takeProfitPrice')?.setValue(55000);
      component.buyOrderForm.get('stopLossPrice')?.setValue(45000);

      component.onSubmitOrder('BUY');

      expect(createOrderResult.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          orderType: OrderType.OCO,
          takeProfitPrice: 55000,
          stopLossPrice: 45000
        }),
        expect.any(Object)
      );
    });
  });

  describe('calculateMaxBuyQuantity with preview fallback (utility)', () => {
    it('should use preview marketPrice when pair currentPrice is null', () => {
      const pairNoPrice = { ...MOCK_PAIR, currentPrice: null as any };
      selectPair(component, pairNoPrice);
      const balances = [{ coin: { id: 'usd-id' }, available: 10000 }] as any;
      const preview = { marketPrice: 50000 } as any;

      expect(calculateMaxBuyQuantity(balances, component.selectedPair(), preview)).toBeGreaterThan(0);
    });
  });
});
