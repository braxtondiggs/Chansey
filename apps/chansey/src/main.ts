import { enableProdMode, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { environment } from './environments/environment';

if (environment.production) {
  enableProdMode();
}

const finalAppConfig = { ...appConfig };

if (!environment.production) {
  // Check if there's an existing service worker and unregister it
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister();
        console.log('ServiceWorker unregistered in dev mode');
      });
    });
  }
}

bootstrapApplication(AppComponent, {
  ...finalAppConfig,
  providers: [provideZoneChangeDetection({ eventCoalescing: true }), ...finalAppConfig.providers]
})
  .then(() => {
    // Register custom service worker for push notifications (production only)
    if (environment.production && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/custom-sw.js').catch((err) => {
        console.warn('Custom SW registration failed:', err);
      });
    }
  })
  .catch((err) => console.error(err));
