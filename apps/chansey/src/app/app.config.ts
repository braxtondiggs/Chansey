import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withEnabledBlockingInitialNavigation, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';
import { providePrimeNG } from 'primeng/config';

import { appRoutes } from './app.routes';

import { environment } from '../environments/environment';

const MyPreset = definePreset(Aura, {
  primary: {
    50: '{blue.50}',
    100: '{blue.100}',
    200: '{blue.200}',
    300: '{blue.300}',
    400: '{blue.400}',
    500: '{blue.500}',
    600: '{blue.600}',
    700: '{blue.700}',
    800: '{blue.800}',
    900: '{blue.900}',
    950: '{blue.950}'
  }
});

const providers = [
  provideRouter(
    appRoutes,
    withInMemoryScrolling({
      anchorScrolling: 'enabled',
      scrollPositionRestoration: 'enabled'
    }),
    withEnabledBlockingInitialNavigation()
  ),
  provideHttpClient(withFetch()),
  provideAnimationsAsync(),
  providePrimeNG({
    theme: {
      preset: MyPreset,
      options: { darkModeSelector: '.app-dark' }
    }
  })
];

if (environment.production) {
  providers.push(
    provideServiceWorker('ngsw-worker.js', {
      enabled: true,
      registrationStrategy: 'registerWhenStable:30000'
    })
  );
}

export const appConfig: ApplicationConfig = {
  providers
};
