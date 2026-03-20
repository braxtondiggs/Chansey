export { ExchangeFormState } from '../../../shared/types/exchange-form.types';

export interface SurfacePalette {
  0?: string;
  50?: string;
  100?: string;
  200?: string;
  300?: string;
  400?: string;
  500?: string;
  600?: string;
  700?: string;
  800?: string;
  900?: string;
  950?: string;
}

export interface ThemeColorOption {
  name?: string;
  palette?: SurfacePalette;
}

export interface MenuModeOption {
  name: string;
  value: string;
  inputId: string;
}

export interface NotificationEventOption {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}
