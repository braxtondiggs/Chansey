import { Injectable, computed, effect, signal } from '@angular/core';

import { Subject } from 'rxjs';

export interface LayoutConfig {
  preset: string;
  primary: string;
  surface: string | undefined | null;
  darkTheme: boolean;
  menuMode: string;
  menuTheme: string;
  cardStyle: string;
}

interface LayoutState {
  staticMenuDesktopInactive?: boolean;
  overlayMenuActive?: boolean;
  configSidebarVisible: boolean;
  staticMenuMobileActive?: boolean;
  menuHoverActive?: boolean;
  sidebarActive: boolean;
  anchored: boolean;
  overlaySubmenuActive: boolean;
  rightMenuVisible: boolean;
  searchBarActive: boolean;
  profileSidebarVisible: boolean;
}

interface MenuChangeEvent {
  key: string;
  routeEvent?: boolean;
}

const CONFIG_STORAGE_KEY = 'chanseyAppConfig';

@Injectable({
  providedIn: 'root'
})
export class LayoutService {
  private _config: LayoutConfig = {
    preset: 'Aura',
    primary: 'blue',
    surface: null,
    darkTheme: false,
    menuMode: 'static',
    menuTheme: 'dark',
    cardStyle: 'transparent'
  };

  private _state: LayoutState = {
    staticMenuDesktopInactive: false,
    overlayMenuActive: false,
    rightMenuVisible: false,
    configSidebarVisible: false,
    staticMenuMobileActive: false,
    menuHoverActive: false,
    searchBarActive: false,
    sidebarActive: false,
    anchored: false,
    overlaySubmenuActive: false,
    profileSidebarVisible: false
  };

  layoutConfig = signal<LayoutConfig>(this._config);

  layoutState = signal<LayoutState>(this._state);

  private configUpdate = new Subject<LayoutConfig>();

  private overlayOpen = new Subject<null>();

  private menuSource = new Subject<MenuChangeEvent>();

  private resetSource = new Subject();

  menuSource$ = this.menuSource.asObservable();

  resetSource$ = this.resetSource.asObservable();

  configUpdate$ = this.configUpdate.asObservable();

  overlayOpen$ = this.overlayOpen.asObservable();

  isDarkTheme = computed(() => this.layoutConfig().darkTheme);

  isSidebarActive = computed(
    () =>
      this.layoutState().overlayMenuActive ||
      this.layoutState().staticMenuMobileActive ||
      this.layoutState().overlaySubmenuActive
  );

  isSlim = computed(() => this.layoutConfig().menuMode === 'slim');

  isHorizontal = computed(() => this.layoutConfig().menuMode === 'horizontal');

  isOverlay = computed(() => this.layoutConfig().menuMode === 'overlay');

  isCompact = computed(() => this.layoutConfig().menuMode === 'compact');

  isStatic = computed(() => this.layoutConfig().menuMode === 'static');

  isReveal = computed(() => this.layoutConfig().menuMode === 'reveal');

  isDrawer = computed(() => this.layoutConfig().menuMode === 'drawer');

  transitionComplete = signal<boolean>(false);

  hideBreadcrumb = signal(false);

  isSidebarStateChanged = computed(() => {
    const layoutConfig = this.layoutConfig();
    return (
      layoutConfig.menuMode === 'horizontal' ||
      layoutConfig.menuMode === 'slim' ||
      layoutConfig.menuMode === 'slim-plus'
    );
  });

  private initialized = false;

  constructor() {
    // Load saved configuration from localStorage during service initialization
    this.loadSavedConfig();

    effect(() => {
      const config = this.layoutConfig();
      if (config) {
        this.onConfigUpdate();
      }
    });

    effect(() => {
      const config = this.layoutConfig();

      if (!this.initialized || !config) {
        this.initialized = true;
        return;
      }

      this.handleDarkModeTransition(config);
    });

    effect(() => {
      if (this.isSidebarStateChanged()) {
        this.reset();
      }
    });
  }

  private loadSavedConfig() {
    try {
      const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (savedConfig) {
        const config = JSON.parse(savedConfig);
        this.layoutConfig.update((state) => ({
          ...state,
          ...config
        }));

        // Apply dark mode immediately on init if needed
        if (config.darkTheme) {
          document.documentElement.classList.add('app-dark');
        }
      } else {
        const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.layoutConfig.update((state) => ({
          ...state,
          darkTheme: isDarkMode
        }));
      }
    } catch (error: unknown) {
      console.error('Error loading saved configuration', error);
    }
  }

  private handleDarkModeTransition(config: LayoutConfig): void {
    const supportsViewTransition = 'startViewTransition' in document;

    if (supportsViewTransition) {
      this.startViewTransition(config);
    } else {
      this.toggleDarkMode(config);
      this.onTransitionEnd();
    }
  }

  private startViewTransition(config: LayoutConfig): void {
    const transition = (document as any).startViewTransition(() => {
      this.toggleDarkMode(config);
    });

    transition.ready
      .then(() => {
        this.onTransitionEnd();
      })
      .catch((error: any) => {
        console.error('Error during view transition:', error);
      });
  }

  toggleDarkMode(config?: LayoutConfig): void {
    const _config = config || this.layoutConfig();
    if (_config.darkTheme) {
      document.documentElement.classList.add('app-dark');
    } else {
      document.documentElement.classList.remove('app-dark');
    }
  }

  private onTransitionEnd() {
    this.transitionComplete.set(true);
    setTimeout(() => {
      this.transitionComplete.set(false);
    });
  }

  toggleConfigSidebar() {
    if (this.isSidebarActive()) {
      this.updateLayoutState({
        overlayMenuActive: false,
        overlaySubmenuActive: false,
        staticMenuMobileActive: false,
        menuHoverActive: false,
        configSidebarVisible: false
      });
    }
    this.updateLayoutState({
      configSidebarVisible: true
    });
  }

  updateLayoutState(newState: Partial<LayoutState>) {
    this.layoutState.update((prev) => ({
      ...prev,
      ...newState
    }));
  }

  onMenuToggle() {
    if (this.isOverlay()) {
      this.updateLayoutState({
        overlayMenuActive: !this.layoutState().overlayMenuActive
      });

      if (this.layoutState().overlayMenuActive) {
        this.overlayOpen.next(null);
      }
    }

    if (this.isDesktop()) {
      this.updateLayoutState({
        staticMenuDesktopInactive: !this.layoutState().staticMenuDesktopInactive
      });
    } else {
      this.updateLayoutState({
        staticMenuMobileActive: !this.layoutState().staticMenuMobileActive
      });

      if (this.layoutState().staticMenuMobileActive) {
        this.overlayOpen.next(null);
      }
    }
  }

  onConfigUpdate() {
    this._config = { ...this.layoutConfig() };
    this.configUpdate.next(this.layoutConfig());

    // Save to localStorage when config changes
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(this._config));
  }

  onMenuStateChange(event: MenuChangeEvent) {
    this.menuSource.next(event);
  }

  reset() {
    this.resetSource.next(true);
  }

  onOverlaySubmenuOpen() {
    this.overlayOpen.next(null);
  }

  showProfileSidebar() {
    this.updateLayoutState({ profileSidebarVisible: true });
  }

  showConfigSidebar() {
    this.updateLayoutState({ configSidebarVisible: true });
  }

  hideConfigSidebar() {
    this.updateLayoutState({ configSidebarVisible: false });
  }

  toggleRightMenu() {
    this.updateLayoutState({
      rightMenuVisible: !this.layoutState().rightMenuVisible
    });
  }

  isDesktop() {
    return window.innerWidth > 991;
  }

  isMobile() {
    return !this.isDesktop();
  }
}
