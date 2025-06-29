import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withEnabledBlockingInitialNavigation, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';
import { QueryClient, provideTanStackQuery, withDevtools } from '@tanstack/angular-query-experimental';
import { providePrimeNG } from 'primeng/config';

import { appRoutes } from './app.routes';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';

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
  provideHttpClient(withFetch(), withInterceptors([AuthInterceptor])),
  provideAnimationsAsync(),
  providePrimeNG({
    theme: {
      preset: MyPreset,
      options: { darkModeSelector: '.app-dark' }
    }
  }),
  // Provide TanStack Query
  provideTanStackQuery(
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 1000 * 60 * 5, // 5 minutes
          gcTime: 1000 * 60 * 10, // 10 minutes
          refetchOnWindowFocus: true,
          retry: true,
          retryDelay: 1000,
          refetchOnReconnect: true,
          refetchOnMount: true
        }
      }
    })
  )
];

// Only add devtools in development
if (!environment.production) {
  providers.push(
    provideTanStackQuery(
      new QueryClient(),
      withDevtools(() => ({ loadDevtools: true, buttonPosition: 'bottom-left' }))
    )
  );
}

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
