import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  Input,
  OnInit,
  PLATFORM_ID,
  Signal,
  booleanAttribute,
  computed,
  inject,
  model,
  DOCUMENT
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { $t, updatePreset, updateSurfacePalette } from '@primeng/themes';
import Aura from '@primeng/themes/aura';
import Lara from '@primeng/themes/lara';
import Nora from '@primeng/themes/nora';
import { PrimeNG } from 'primeng/config';
import { DrawerModule } from 'primeng/drawer';
import { RadioButtonModule } from 'primeng/radiobutton';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { getPresetExtension } from './preset-utils';
import { SurfacesType, surfaces } from './surface-palettes';

import { LayoutService } from '../shared/services/layout.service';

const presets = {
  Aura,
  Lara,
  Nora
} as const;

declare type KeyOfType<T> = keyof T extends infer U ? U : never;

@Component({
  selector: 'app-configurator',
  standalone: true,
  imports: [FormsModule, SelectButtonModule, DrawerModule, ToggleSwitchModule, RadioButtonModule],
  templateUrl: './app.configurator.html'
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppConfigurator implements OnInit {
  @Input({ transform: booleanAttribute }) simple = false;

  @Input() location = 'app';

  router = inject(Router);

  config: PrimeNG = inject(PrimeNG);

  layoutService: LayoutService = inject(LayoutService);

  platformId = inject(PLATFORM_ID);

  primeng = inject(PrimeNG);

  presets = Object.keys(presets);

  themeOptions = [
    { name: 'Light', value: false },
    { name: 'Dark', value: true }
  ];

  menuThemeOptions: { name: string; value: string }[] = [];

  surfaces = surfaces;

  selectedPrimaryColor = computed(() => {
    return this.layoutService.layoutConfig().primary;
  });

  selectedSurfaceColor = computed(() => this.layoutService.layoutConfig().surface);

  selectedPreset = computed(() => this.layoutService.layoutConfig().preset);

  menuMode = model(this.layoutService.layoutConfig().menuMode);

  cardStyle = model(this.layoutService.layoutConfig().cardStyle);

  visible: Signal<boolean> = computed(() => this.layoutService.layoutState().configSidebarVisible);

  darkTheme = computed(() => this.layoutService.layoutConfig().darkTheme);

  selectedSurface = computed(() => this.layoutService.layoutConfig().surface);

  cardStyleOptions = [
    { name: 'Transparent', value: 'transparent' },
    { name: 'Filled', value: 'filled' }
  ];

  primaryColors = computed<SurfacesType[]>(() => {
    const presetPalette = presets[this.layoutService.layoutConfig().preset as KeyOfType<typeof presets>].primitive;
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

    return palettes;
  });

  menuTheme = computed(() => this.layoutService.layoutConfig().menuTheme);

  private document = inject(DOCUMENT);

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.onPresetChange(this.layoutService.layoutConfig().preset);
    }
    this.updateMenuThemeOptions();
  }

  updateMenuThemeOptions() {
    if (this.darkTheme()) {
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

  getPresetExt() {
    return getPresetExtension(this.primaryColors(), this.selectedPrimaryColor());
  }

  updateColors(event: any, type: string, color: any) {
    if (type === 'primary') {
      this.layoutService.layoutConfig.update((state) => ({
        ...state,
        primary: color.name
      }));

      // Update theme-color meta tag
      if (isPlatformBrowser(this.platformId)) {
        const metaThemeColor = this.document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
          // Set the theme-color to match the primary color
          const colorValue =
            color.name === 'noir'
              ? this.darkTheme()
                ? '#ffffff'
                : '#0f172a' // Use appropriate noir color based on theme
              : color.palette?.['500']; // Use the 500 shade for other colors
          metaThemeColor.setAttribute('content', colorValue);
        }
      }
    } else if (type === 'surface') {
      this.layoutService.layoutConfig.update((state) => ({
        ...state,
        surface: color.name
      }));
    }
    this.applyTheme(type, color);

    event.stopPropagation();
  }

  applyTheme(type: string, color: any) {
    if (type === 'primary') {
      updatePreset(this.getPresetExt());
    } else if (type === 'surface') {
      updateSurfacePalette(color.palette);
    }
  }

  onPresetChange(event: any) {
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      preset: event
    }));
    const preset = presets[event as KeyOfType<typeof presets>];
    const surfacePalette = this.surfaces.find((s) => s.name === this.selectedSurfaceColor())?.palette;
    $t().preset(preset).preset(this.getPresetExt()).surfacePalette(surfacePalette).use({ useDefaultOptions: true });
  }

  onDrawerHide() {
    this.layoutService.hideConfigSidebar();
  }

  onCardStyleChange(value: string) {
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      cardStyle: value
    }));
  }

  onMenuThemeChange(value: string) {
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      menuTheme: value
    }));
  }

  setMenuMode(mode: string) {
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      menuMode: mode
    }));

    if (this.menuMode() === 'static') {
      this.layoutService.layoutState.update((state) => ({
        ...state,
        staticMenuDesktopInactive: false
      }));
    }
  }

  toggleDarkMode() {
    this.executeDarkModeToggle();
  }

  executeDarkModeToggle() {
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      darkTheme: !state.darkTheme
    }));
    if (this.darkTheme()) {
      this.setMenuTheme('dark');
    }
    this.updateMenuThemeOptions();
  }

  toggleConfigSidebar() {
    this.layoutService.layoutState.update((val) => ({
      ...val,
      configSidebarVisible: !val.configSidebarVisible
    }));
  }

  setMenuTheme(theme: string) {
    this.layoutService.layoutConfig.update((state) => ({
      ...state,
      menuTheme: theme
    }));
  }
}
