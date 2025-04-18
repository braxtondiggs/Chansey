import { NgClass } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { AppConfigurator } from './app.configurator';

import { LayoutService } from '../services/layout.service';

@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [RouterModule, AppConfigurator, NgClass],
  template: `
    <div [ngClass]="{ 'app-dark': layoutService.isDarkTheme() }">
      <main>
        <router-outlet></router-outlet>
      </main>
      <button class="layout-config-button config-link" (click)="layoutService.toggleConfigSidebar()">
        <i class="pi pi-cog"></i>
      </button>
      <app-configurator location="landing" />
    </div>
  `
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AuthLayout implements OnInit {
  layoutService = inject(LayoutService);

  ngOnInit() {
    // Load persistent settings from localStorage
    const savedSettings = localStorage.getItem('chanseyAppConfig');
    if (savedSettings) {
      try {
        const config = JSON.parse(savedSettings);
        this.layoutService.layoutConfig.update((state) => ({
          ...state,
          ...config
        }));

        // Apply theme settings immediately
        this.layoutService.toggleDarkMode();
      } catch (e) {
        console.error('Error loading saved configuration', e);
      }
    }

    // Save configuration changes to localStorage
    this.layoutService.configUpdate$.subscribe((config) => {
      localStorage.setItem('chanseyAppConfig', JSON.stringify(config));
    });
  }
}
