import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ToastModule } from 'primeng/toast';

import { LayoutService } from '../../../services';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CardModule, DividerModule, InputSwitchModule, ToastModule],
  providers: [MessageService],
  template: `
    <div class="card p-4 md:p-6">
      <div class="text-900 mb-4 text-xl font-medium">Settings</div>
      <p class="text-600 mb-5">Customize your application preferences and settings</p>

      <div class="grid">
        <div class="col-12 lg:col-6">
          <div class="surface-section border-round shadow-2 h-full p-4">
            <div class="text-900 mb-4 text-lg font-medium">Appearance</div>
            <p-divider></p-divider>

            <div class="align-items-center justify-content-between flex py-3">
              <div>
                <div class="text-900 mb-1 font-medium">Dark Mode</div>
                <div class="text-600 text-sm">Switch between light and dark theme</div>
              </div>
              <p-inputSwitch [(ngModel)]="darkMode" (onChange)="toggleDarkMode()"></p-inputSwitch>
            </div>

            <div class="align-items-center justify-content-between flex py-3">
              <div>
                <div class="text-900 mb-1 font-medium">Compact Mode</div>
                <div class="text-600 text-sm">Reduce spacing and sizing of UI elements</div>
              </div>
              <p-inputSwitch [(ngModel)]="compactMode" (onChange)="toggleCompactMode()"></p-inputSwitch>
            </div>
          </div>
        </div>

        <div class="col-12 lg:col-6">
          <div class="surface-section border-round shadow-2 h-full p-4">
            <div class="text-900 mb-4 text-lg font-medium">Notifications</div>
            <p-divider></p-divider>

            <div class="align-items-center justify-content-between flex py-3">
              <div>
                <div class="text-900 mb-1 font-medium">Email Notifications</div>
                <div class="text-600 text-sm">Receive email updates about your account</div>
              </div>
              <p-inputSwitch [(ngModel)]="emailNotifications" (onChange)="saveSettings()"></p-inputSwitch>
            </div>

            <div class="align-items-center justify-content-between flex py-3">
              <div>
                <div class="text-900 mb-1 font-medium">Push Notifications</div>
                <div class="text-600 text-sm">Receive notifications on your device</div>
              </div>
              <p-inputSwitch [(ngModel)]="pushNotifications" (onChange)="saveSettings()"></p-inputSwitch>
            </div>
          </div>
        </div>

        <div class="col-12">
          <div class="surface-section border-round shadow-2 p-4">
            <div class="text-900 mb-4 text-lg font-medium">Privacy & Security</div>
            <p-divider></p-divider>

            <div class="align-items-center justify-content-between flex py-3">
              <div>
                <div class="text-900 mb-1 font-medium">Two-Factor Authentication</div>
                <div class="text-600 text-sm">Add an extra layer of security to your account</div>
              </div>
              <p-inputSwitch [(ngModel)]="twoFactorAuth" (onChange)="saveSettings()"></p-inputSwitch>
            </div>

            <div class="mt-4">
              <button
                pButton
                label="Save All Settings"
                icon="pi pi-save"
                (click)="saveAllSettings()"
                class="w-auto"
              ></button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <p-toast></p-toast>
  `
})
export class SettingsComponent {
  darkMode: boolean;
  compactMode = false;
  emailNotifications = true;
  pushNotifications = true;
  twoFactorAuth = false;

  constructor(
    private layoutService: LayoutService,
    private messageService: MessageService
  ) {
    // Initialize dark mode based on current theme
    this.darkMode = this.layoutService.isDarkTheme();
  }

  toggleDarkMode(): void {
    this.layoutService.toggleDarkMode();
  }

  toggleCompactMode(): void {
    // In a real application, this would update the layout or UI density
    console.log('Compact mode:', this.compactMode);
    this.saveSettings();
  }

  saveSettings(): void {
    // Simulate saving individual settings
    console.log('Settings saved');
  }

  saveAllSettings(): void {
    // In a real application, this would save all settings to a backend
    this.messageService.add({
      severity: 'success',
      summary: 'Settings Saved',
      detail: 'Your settings have been updated successfully'
    });
  }
}
