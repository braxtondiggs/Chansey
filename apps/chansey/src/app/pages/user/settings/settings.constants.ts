import { NotificationEventType } from '@chansey/api-interfaces';

import { type MenuModeOption, type NotificationEventOption, type ThemeColorOption } from './settings.types';

export const SURFACE_PALETTES: ThemeColorOption[] = [
  {
    name: 'slate',
    palette: {
      0: '#ffffff',
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
      950: '#020617'
    }
  },
  {
    name: 'gray',
    palette: {
      0: '#ffffff',
      50: '#f9fafb',
      100: '#f3f4f6',
      200: '#e5e7eb',
      300: '#d1d5db',
      400: '#9ca3af',
      500: '#6b7280',
      600: '#4b5563',
      700: '#374151',
      800: '#1f2937',
      900: '#111827',
      950: '#030712'
    }
  },
  {
    name: 'zinc',
    palette: {
      0: '#ffffff',
      50: '#fafafa',
      100: '#f4f4f5',
      200: '#e4e4e7',
      300: '#d4d4d8',
      400: '#a1a1aa',
      500: '#71717a',
      600: '#52525b',
      700: '#3f3f46',
      800: '#27272a',
      900: '#18181b',
      950: '#09090b'
    }
  },
  {
    name: 'neutral',
    palette: {
      0: '#ffffff',
      50: '#fafafa',
      100: '#f5f5f5',
      200: '#e5e5e5',
      300: '#d4d4d4',
      400: '#a3a3a3',
      500: '#737373',
      600: '#525252',
      700: '#404040',
      800: '#262626',
      900: '#171717',
      950: '#0a0a0a'
    }
  },
  {
    name: 'stone',
    palette: {
      0: '#ffffff',
      50: '#fafaf9',
      100: '#f5f5f4',
      200: '#e7e5e4',
      300: '#d6d3d1',
      400: '#a8a29e',
      500: '#78716c',
      600: '#57534e',
      700: '#44403c',
      800: '#292524',
      900: '#1c1917',
      950: '#0c0a09'
    }
  },
  {
    name: 'soho',
    palette: {
      0: '#ffffff',
      50: '#ececec',
      100: '#dedfdf',
      200: '#c4c4c6',
      300: '#adaeb0',
      400: '#97979b',
      500: '#7f8084',
      600: '#6a6b70',
      700: '#55565b',
      800: '#3f4046',
      900: '#2c2c34',
      950: '#16161d'
    }
  },
  {
    name: 'viva',
    palette: {
      0: '#ffffff',
      50: '#f3f3f3',
      100: '#e7e7e8',
      200: '#cfd0d0',
      300: '#b7b8b9',
      400: '#9fa1a1',
      500: '#87898a',
      600: '#6e7173',
      700: '#565a5b',
      800: '#3e4244',
      900: '#262b2c',
      950: '#0e1315'
    }
  },
  {
    name: 'ocean',
    palette: {
      0: '#ffffff',
      50: '#fbfcfc',
      100: '#F7F9F8',
      200: '#EFF3F2',
      300: '#DADEDD',
      400: '#B1B7B6',
      500: '#828787',
      600: '#5F7274',
      700: '#415B61',
      800: '#29444E',
      900: '#183240',
      950: '#0c1920'
    }
  }
];

export const PRIMARY_COLOR_NAMES = [
  'emerald',
  'green',
  'lime',
  'orange',
  'amber',
  'yellow',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose'
] as const;

export const CARD_STYLE_OPTIONS = [
  { name: 'Transparent', value: 'transparent' },
  { name: 'Filled', value: 'filled' }
];

export const MENU_MODE_OPTIONS: MenuModeOption[] = [
  { name: 'Static', value: 'static', inputId: 'static' },
  { name: 'Overlay', value: 'overlay', inputId: 'overlay' },
  { name: 'Slim', value: 'slim', inputId: 'slim' },
  { name: 'Compact', value: 'compact', inputId: 'compact' },
  { name: 'Reveal', value: 'reveal', inputId: 'reveal' },
  { name: 'Drawer', value: 'drawer', inputId: 'drawer' },
  { name: 'Horizontal', value: 'horizontal', inputId: 'horizontal' }
];

export const NOTIFICATION_EVENT_OPTIONS: NotificationEventOption[] = [
  {
    key: NotificationEventType.TRADE_EXECUTED,
    label: 'Trade Executed',
    description: 'When a trade is successfully placed',
    enabled: true
  },
  {
    key: NotificationEventType.TRADE_ERROR,
    label: 'Trade Errors',
    description: 'When a trade fails to execute',
    enabled: true
  },
  {
    key: NotificationEventType.RISK_BREACH,
    label: 'Risk Breaches',
    description: 'When risk limits are exceeded',
    enabled: true
  },
  {
    key: NotificationEventType.DRIFT_ALERT,
    label: 'Drift Alerts',
    description: 'When strategy performance drifts',
    enabled: true
  },
  {
    key: NotificationEventType.TRADING_HALTED,
    label: 'Trading Halted',
    description: 'When trading is stopped',
    enabled: true
  },
  {
    key: NotificationEventType.DAILY_SUMMARY,
    label: 'Daily Summary',
    description: 'End-of-day trading recap',
    enabled: true
  },
  {
    key: NotificationEventType.STRATEGY_DEPLOYED,
    label: 'Strategy Deployed',
    description: 'When a strategy goes live',
    enabled: true
  },
  {
    key: NotificationEventType.STRATEGY_DEMOTED,
    label: 'Strategy Demoted',
    description: 'When a strategy is pulled back',
    enabled: true
  },
  {
    key: NotificationEventType.DAILY_LOSS_LIMIT,
    label: 'Daily Loss Limit',
    description: 'When daily loss limit is hit',
    enabled: true
  }
];

export const HOURS = Array.from({ length: 24 }, (_, i) => i);
