import { OrderType, TrailingType } from '@chansey/api-interfaces';

/** PrimeNG Pass Through (PT) for buy/sell tabs */
export const TAB_LIST_PT = {
  root: 'bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-1 overflow-hidden',
  tabList: 'bg-transparent !border-none gap-1 w-full flex',
  content: '!border-none',
  activeBar: '!hidden'
};

export const TAB_PANELS_PT = {
  root: '!p-0 bg-transparent'
};

export const TAB_INACTIVE_CLASSES =
  'flex-1 flex justify-center items-center !py-1.5 !px-3 !border-none !bg-transparent m-0 rounded-lg font-semibold text-sm transition-all duration-200 !text-surface-600 dark:!text-surface-300 hover:!bg-surface-200/60 dark:hover:!bg-surface-700/60 hover:!text-surface-800 dark:hover:!text-surface-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50';

export const BUY_ACTIVE_CLASSES =
  'flex-1 flex justify-center items-center !py-1.5 !px-3 !border-none m-0 rounded-lg font-semibold text-md transition-all duration-200 !bg-green-500 !text-white hover:!bg-green-600 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50';

export const SELL_ACTIVE_CLASSES =
  'flex-1 flex justify-center items-center !py-1.5 !px-3 !border-none m-0 rounded-lg font-semibold text-md transition-all duration-200 !bg-red-500 !text-white hover:!bg-red-600 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50';

export const ENHANCED_ORDER_TYPE_OPTIONS = [
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

export const QUICK_AMOUNT_OPTIONS = [
  { label: '25%', value: 25 },
  { label: '50%', value: 50 },
  { label: '75%', value: 75 },
  { label: 'Max', value: 100 }
];

export const TRAILING_TYPE_OPTIONS = [
  { label: 'Amount', value: TrailingType.AMOUNT },
  { label: 'Percentage', value: TrailingType.PERCENTAGE }
];
