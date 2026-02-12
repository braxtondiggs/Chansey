import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withEnabledBlockingInitialNavigation, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { withDevtools } from '@tanstack/angular-query-experimental/devtools';
import { providePrimeNG } from 'primeng/config';

import { isApiError } from '@chansey/shared';

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
          retry: (failureCount, error) => {
            // Don't retry auth errors — authenticatedFetch already handled refresh
            if (isApiError(error) && (error.statusCode === 401 || error.statusCode === 403)) {
              return false;
            }
            return failureCount < 2;
          },
          retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff
          refetchOnReconnect: true,
          refetchOnMount: true
        }
      }
    }),
    ...(environment.production ? [] : [withDevtools(() => ({ loadDevtools: true, buttonPosition: 'bottom-left' }))])
  )
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
