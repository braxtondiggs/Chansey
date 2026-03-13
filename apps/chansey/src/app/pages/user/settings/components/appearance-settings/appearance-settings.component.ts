import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { $t, updatePreset, updateSurfacePalette } from '@primeng/themes';
import Aura from '@primeng/themes/aura';
import Lara from '@primeng/themes/lara';
import Nora from '@primeng/themes/nora';
import { PanelModule } from 'primeng/panel';
import { RadioButtonModule } from 'primeng/radiobutton';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { LayoutService } from '../../../../../shared/services/layout.service';
import { CARD_STYLE_OPTIONS, MENU_MODE_OPTIONS, PRIMARY_COLOR_NAMES, SURFACE_PALETTES } from '../../settings.constants';
import { ThemeColorOption } from '../../settings.types';
import { createPanelState } from '../../utils/panel-state';

const presets = { Aura, Lara, Nora } as const;
type PresetKey = keyof typeof presets;

@Component({
  selector: 'app-appearance-settings',
  imports: [FormsModule, PanelModule, RadioButtonModule, SelectButtonModule, ToggleSwitchModule],
  templateUrl: './appearance-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppearanceSettingsComponent {
  private layoutService = inject(LayoutService);

  readonly presetNames = Object.keys(presets);
  readonly surfaces = SURFACE_PALETTES;
  readonly cardStyleOptions = CARD_STYLE_OPTIONS;
  readonly menuModeOptions = MENU_MODE_OPTIONS;

  darkMode: boolean;
  selectedPreset: string;
  selectedPrimaryColor: string;
  selectedSurfaceColor: string;
  menuMode: string;
  cardStyle: string;
  menuTheme: string;
  menuThemeOptions: { name: string; value: string }[] = [];
  primaryColors: ThemeColorOption[] = [];

  private panelState = createPanelState('appearance', ['colorScheme', 'menuSettings']);
  panelCollapsed = this.panelState.collapsed;
  onPanelToggle = this.panelState.onToggle;

  constructor() {
    const config = this.layoutService.layoutConfig();
    this.darkMode = this.layoutService.isDarkTheme();
    this.selectedPreset = config.preset;
    this.menuMode = config.menuMode;
    this.cardStyle = config.cardStyle;
    this.menuTheme = config.menuTheme;
    this.selectedPrimaryColor = config.primary;
    this.selectedSurfaceColor = config.surface as string;

    this.updatePrimaryColors();
    this.updateMenuThemeOptions();
  }

  toggleDarkMode(): void {
    this.layoutService.layoutConfig.update((state) => ({ ...state, darkTheme: this.darkMode }));
    if (this.darkMode) {
      this.setMenuTheme('dark');
    }
    this.updateMenuThemeOptions();
  }

  onPresetChange(event: string): void {
    this.selectedPreset = event;
    this.layoutService.layoutConfig.update((state) => ({ ...state, preset: event }));
    this.updatePrimaryColors();

    const preset = presets[event as PresetKey];
    const surfacePalette = this.surfaces.find((s) => s.name === this.selectedSurfaceColor)?.palette;
    $t().preset(preset).preset(this.getPresetExt()).surfacePalette(surfacePalette).use({ useDefaultOptions: true });
  }

  onCardStyleChange(value: string): void {
    this.cardStyle = value;
    this.layoutService.layoutConfig.update((state) => ({ ...state, cardStyle: value }));
  }

  onMenuThemeChange(value: string): void {
    this.menuTheme = value;
    this.layoutService.layoutConfig.update((state) => ({ ...state, menuTheme: value }));
  }

  setMenuMode(mode: string): void {
    this.menuMode = mode;
    this.layoutService.layoutConfig.update((state) => ({ ...state, menuMode: mode }));
    if (mode === 'static') {
      this.layoutService.layoutState.update((state) => ({ ...state, staticMenuDesktopInactive: false }));
    }
  }

  updateColors(event: MouseEvent, type: 'primary' | 'surface', color: ThemeColorOption): void {
    const name = color.name ?? '';
    if (type === 'primary') {
      this.selectedPrimaryColor = name;
      this.layoutService.layoutConfig.update((state) => ({ ...state, primary: name }));
    } else {
      this.selectedSurfaceColor = name;
      this.layoutService.layoutConfig.update((state) => ({ ...state, surface: color.name }));
    }
    this.applyTheme(type, color);
    event.stopPropagation();
  }

  private applyTheme(type: 'primary' | 'surface', color: ThemeColorOption): void {
    if (type === 'primary') {
      updatePreset(this.getPresetExt());
    } else if (color.palette) {
      updateSurfacePalette(color.palette);
    }
  }

  private getPresetExt(): Record<string, unknown> {
    const color = this.primaryColors.find((c) => c.name === this.selectedPrimaryColor) || {};

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
    }

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

  private setMenuTheme(theme: string): void {
    this.menuTheme = theme;
    this.layoutService.layoutConfig.update((state) => ({ ...state, menuTheme: theme }));
  }

  private updatePrimaryColors(): void {
    const presetPalette = presets[this.selectedPreset as PresetKey].primitive;
    const palettes: ThemeColorOption[] = [{ name: 'noir', palette: {} }];
    for (const color of PRIMARY_COLOR_NAMES) {
      palettes.push({
        name: color,
        palette: presetPalette?.[color as keyof typeof presetPalette] as ThemeColorOption['palette']
      });
    }
    this.primaryColors = palettes;
  }

  private updateMenuThemeOptions(): void {
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
}
