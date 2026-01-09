import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';

import { $t, updatePreset, updateSurfacePalette } from '@primeng/themes';
import Aura from '@primeng/themes/aura';
import Lara from '@primeng/themes/lara';
import Nora from '@primeng/themes/nora';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { FloatLabelModule } from 'primeng/floatlabel';
import { PanelModule } from 'primeng/panel';
import { PasswordModule } from 'primeng/password';
import { RadioButtonModule } from 'primeng/radiobutton';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TabsModule } from 'primeng/tabs';
import { ToastModule } from 'primeng/toast';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { AuthService } from '@chansey-web/app/shared/services/auth.service';
import { LayoutService } from '@chansey-web/app/shared/services/layout.service';

import { SettingsService } from './settings.service';

const presets = {
  Aura,
  Lara,
  Nora
} as const;

declare type KeyOfType<T> = keyof T extends infer U ? U : never;

declare type SurfacesType = {
  name?: string;
  palette?: {
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
  };
};

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    ButtonModule,
    CardModule,
    ConfirmDialogModule,
    DialogModule,
    FloatLabelModule,
    FormsModule,
    PanelModule,
    PasswordModule,
    RadioButtonModule,
    ReactiveFormsModule,
    SelectButtonModule,
    TabsModule,
    ToastModule,
    ToggleSwitchModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './settings.component.html'
})
export class SettingsComponent implements OnInit {
  private layoutService = inject(LayoutService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private settingsService = inject(SettingsService);
  private authService = inject(AuthService);
  private fb = inject(FormBuilder);

  // TanStack Query
  readonly userQuery = this.authService.useUser();
  readonly enableOtpMutation = this.settingsService.useEnableOtpMutation();
  readonly disableOtpMutation = this.settingsService.useDisableOtpMutation();

  darkMode = this.layoutService.isDarkTheme();
  compactMode = false;
  emailNotifications = true;
  activeTab = 0;

  // Password dialog for disabling 2FA
  showPasswordDialog = signal(false);
  disablePassword = '';

  // Form groups
  notificationForm: FormGroup = this.fb.group({
    pushNotifications: new FormControl(false)
  });

  securityForm: FormGroup = this.fb.group({
    twoFactorAuth: new FormControl({ value: false, disabled: false })
  });

  // Theme related properties
  presets = Object.keys(presets);
  menuMode: string = '';
  cardStyle: string = '';
  menuTheme: string = '';
  selectedPreset: string = '';
  selectedPrimaryColor: string = '';
  selectedSurfaceColor: string = '';

  menuThemeOptions: { name: string; value: string }[] = [];

  cardStyleOptions = [
    { name: 'Transparent', value: 'transparent' },
    { name: 'Filled', value: 'filled' }
  ];

  // Surface palette options
  surfaces: SurfacesType[] = [
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

  // Primary color options
  primaryColors: SurfacesType[] = [];

  ngOnInit(): void {
    const userData = this.userQuery.data();
    if (userData) {
      this.securityForm.patchValue({ twoFactorAuth: userData.otpEnabled });
    }

    this.checkNotificationPermission();
    this.notificationForm.get('pushNotifications')?.valueChanges.subscribe(() => {
      this.requestPushNotificationPermission();
    });

    // Initialize theme-related properties
    const config = this.layoutService.layoutConfig();
    this.selectedPreset = config.preset;
    this.menuMode = config.menuMode;
    this.cardStyle = config.cardStyle;
    this.menuTheme = config.menuTheme;
    this.selectedPrimaryColor = config.primary;
    this.selectedSurfaceColor = config.surface as string;

    // Generate primary colors
    this.updatePrimaryColors();

    // Update menu theme options based on current theme
    this.updateMenuThemeOptions();
  }

  // Track by function for ngFor
  trackByName(index: number, item: SurfacesType): string {
    return item.name || '';
  }

  // Update primary colors based on selected preset
  updatePrimaryColors(): void {
    const presetPalette = presets[this.selectedPreset as KeyOfType<typeof presets>].primitive;
    const colors = [
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
    ];
    const palettes: SurfacesType[] = [{ name: 'noir', palette: {} }];

    colors.forEach((color) => {
      palettes.push({
        name: color,
        palette: presetPalette?.[color as KeyOfType<typeof presetPalette>] as SurfacesType['palette']
      });
    });

    this.primaryColors = palettes;
  }

  // Update menu theme options based on current theme
  updateMenuThemeOptions(): void {
    if (this.darkMode) {
      this.menuThemeOptions = [
        { name: 'Dark', value: 'dark' },
        { name: 'Primary', value: 'primary' }
      ];
    } else {
      this.menuThemeOptions = [
        { name: 'Light', value: 'light' },
        { name: 'Dark', value: 'dark' },
        { name: 'Primary', value: 'primary' }
      ];
    }
  }

  // Updates colors when a primary or surface color is selected
  updateColors(event: any, type: string, color: any): void {
    if (type === 'primary') {
      this.selectedPrimaryColor = color.name;
      this.layoutService.layoutConfig.update((state) => ({
        ...state,
        primary: color.name
      }));
    } else if (type === 'surface') {
      this.selectedSurfaceColor = color.name;
      this.layoutService.layoutConfig.update((state) => ({
        ...state,
        surface: color.name
      }));
    }
    this.applyTheme(type, color);

    event.stopPropagation();
  }

  // Apply theme changes
  applyTheme(type: string, color: any): void {
    if (type === 'primary') {
      updatePreset(this.getPresetExt());
    } else if (type === 'surface') {
      updateSurfacePalette(color.palette);
    }
  }

  // Generate preset extension based on selected primary color
  getPresetExt(): any {
    const color: SurfacesType = this.primaryColors.find((c) => c.name === this.selectedPrimaryColor) || {};

    if (color.name === 'noir') {
      return {
        semantic: {
          primary: {
            50: '{surface.50}',
            100: '{surface.100}',
            200: '{surface.200}',
            300: '{surface.300}',
            400: '{surface.400}',
            500: '{surface.500}',
            600: '{surface.600}',
            700: '{surface.700}',
            800: '{surface.800}',
            900: '{surface.900}',
            950: '{surface.950}'
          },
          colorScheme: {
            light: {
              primary: {
                color: '{primary.950}',
                contrastColor: '#ffffff',
                hoverColor: '{primary.800}',
                activeColor: '{primary.700}'
              },
              highlight: {
                background: '{primary.950}',
                focusBackground: '{primary.700}',
                color: '#ffffff',
                focusColor: '#ffffff'
              }
            },
            dark: {
              primary: {
                color: '{primary.50}',
                contrastColor: '{primary.950}',
                hoverColor: '{primary.200}',
                activeColor: '{primary.300}'
              },
              highlight: {
                background: '{primary.50}',
                focusBackground: '{primary.300}',
                color: '{primary.950}',
                focusColor: '{primary.950}'
              }
            }
          }
        }
      };
    } else {
      return {
        semantic: {
          primary: color.palette,
          colorScheme: {
            light: {
              primary: {
                color: '{primary.500}',
                contrastColor: '#ffffff',
                hoverColor: '{primary.600}',
                activeColor: '{primary.700}'
              },
              highlight: {
                background: '{primary.50}',
                focusBackground: '{primary.100}',
                color: '{primary.700}',
                focusColor: '{primary.800}'
              }
            },
            dark: {
              primary: {
                color: '{primary.400}',
                contrastColor: '{surface.900}',
                hoverColor: '{primary.300}',
                activeColor: '{primary.200}'
              },
              highlight: {
                background: 'color-mix(in srgb, {primary.400}, transparent 84%)',
                focusBackground: 'color-mix(in srgb, {primary.400}, transparent 76%)',
                color: 'rgba(255,255,255,.87)',
                focusColor: 'rgba(255,255,255,.87)'
              }
            }
          }
        }
      };
    }
  }

  // Handle preset change
  onPresetChange(event: any): void {
    this.selectedPreset = event;
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      preset: event
    }));

    // Update primary colors for the new preset
    this.updatePrimaryColors();

    const preset = presets[event as KeyOfType<typeof presets>];
    const surfacePalette = this.surfaces.find((s) => s.name === this.selectedSurfaceColor)?.palette;
    $t().preset(preset).preset(this.getPresetExt()).surfacePalette(surfacePalette).use({ useDefaultOptions: true });
  }

  // Handle card style change
  onCardStyleChange(value: string): void {
    this.cardStyle = value;
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      cardStyle: value
    }));
  }

  // Handle menu theme change
  onMenuThemeChange(value: string): void {
    this.menuTheme = value;
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      menuTheme: value
    }));
  }

  // Set menu mode
  setMenuMode(mode: string): void {
    this.menuMode = mode;
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      menuMode: mode
    }));

    if (this.menuMode === 'static') {
      this.layoutService.layoutState.update((state) => ({
        ...state,
        staticMenuDesktopInactive: false
      }));
    }
  }

  // Toggle dark mode
  toggleDarkMode(): void {
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      darkTheme: this.darkMode
    }));

    if (this.darkMode) {
      this.setMenuTheme('dark');
    }

    this.updateMenuThemeOptions();
  }

  // Set menu theme
  setMenuTheme(theme: string): void {
    this.menuTheme = theme;
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      menuTheme: theme
    }));
  }

  toggleCompactMode(): void {
    // In a real application, this would update the layout or UI density
    console.log('Compact mode:', this.compactMode);
    //this.saveSettings();
  }

  saveNotificationSettings(): void {
    this.messageService.add({
      severity: 'success',
      summary: 'Settings Saved',
      detail: 'Your settings have been updated successfully'
    });
  }

  private requestPushNotificationPermission(): void {
    if ('Notification' in window) {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          this.saveNotificationSettings();
        } else {
          this.notificationForm.get('pushNotifications')?.setValue(false, { emitEvent: false });
          this.messageService.add({
            severity: 'warn',
            summary: 'Permission Denied',
            detail: 'Push notification permission was denied'
          });
        }
      });
    } else {
      this.notificationForm.get('pushNotifications')?.setValue(false, { emitEvent: false });
      this.messageService.add({
        severity: 'error',
        summary: 'Not Supported',
        detail: 'Your browser does not support push notifications'
      });
    }
  }

  private checkNotificationPermission(): void {
    if ('Notification' in window) {
      const permission = Notification.permission;
      if (permission === 'granted') {
        this.notificationForm.get('pushNotifications')?.setValue(true, { emitEvent: false });
      } else if (permission === 'denied') {
        this.notificationForm.get('pushNotifications')?.setValue(false, { emitEvent: false });
      }
    } else {
      this.notificationForm.get('pushNotifications')?.setValue(false, { emitEvent: false });
    }
  }

  toggleTwoFactorAuth(event: { checked: boolean }): void {
    const twoFactorControl = this.securityForm.get('twoFactorAuth');

    if (event.checked) {
      this.confirmationService.confirm({
        header: 'Enable Two-Factor Authentication',
        message:
          'This will add an extra layer of security to your account. You will need to verify your identity using an additional method when logging in. Continue?',
        icon: 'pi pi-lock',
        acceptButtonProps: {
          label: 'Enable 2FA',
          severity: 'primary'
        },
        rejectButtonProps: {
          label: 'Cancel',
          severity: 'secondary'
        },
        accept: () => {
          this.enableOtpMutation.mutate(undefined, {
            onSuccess: () => {
              this.securityForm.patchValue({ twoFactorAuth: true });
              this.messageService.add({
                severity: 'success',
                summary: '2FA Enabled',
                detail: 'Two-factor authentication has been enabled'
              });
            },
            onError: (error: Error) => {
              twoFactorControl?.setValue(false, { emitEvent: false });
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: error?.message || 'Failed to enable 2FA'
              });
            }
          });
        },
        reject: () => {
          twoFactorControl?.setValue(false, { emitEvent: false });
        }
      });
    } else {
      // Reset toggle to ON before showing dialog
      twoFactorControl?.setValue(true, { emitEvent: false });

      // Show password dialog for disabling 2FA
      this.disablePassword = '';
      this.showPasswordDialog.set(true);
    }
  }

  confirmDisable2FA(): void {
    if (!this.disablePassword) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Password Required',
        detail: 'Please enter your password to disable 2FA'
      });
      return;
    }

    const twoFactorControl = this.securityForm.get('twoFactorAuth');

    this.disableOtpMutation.mutate(
      { password: this.disablePassword },
      {
        onSuccess: () => {
          this.showPasswordDialog.set(false);
          this.disablePassword = '';
          this.securityForm.get('twoFactorAuth')?.setValue(false);
          this.messageService.add({
            severity: 'warn',
            summary: '2FA Disabled',
            detail: 'Two-factor authentication has been disabled'
          });
        },
        onError: (error: Error) => {
          twoFactorControl?.setValue(true, { emitEvent: false });
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error?.message || 'Failed to disable 2FA. Check your password.'
          });
        }
      }
    );
  }

  cancelDisable2FA(): void {
    this.showPasswordDialog.set(false);
    this.disablePassword = '';
  }
}
