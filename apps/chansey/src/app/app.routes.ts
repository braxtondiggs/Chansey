import { Route } from '@angular/router';

import { AuthGuard } from './guard/auth.guard';
import { ReverseAuthGuard } from './guard/reverse-auth.guard';
import { AppLayout } from './layout/app.layout';
import { AuthLayout } from './layout/auth.layout';

export const appRoutes: Route[] = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: '',
    component: AuthLayout,
    canActivate: [ReverseAuthGuard],
    children: [
      {
        path: 'login',
        loadComponent: () => import('./pages/auth/login').then((c) => c.LoginComponent)
      },
      {
        path: 'register',
        loadComponent: () => import('./pages/auth/register').then((c) => c.RegisterComponent)
      },
      {
        path: 'forgot-password',
        loadComponent: () => import('./pages/auth/forgot').then((c) => c.ForgotComponent)
      },
      {
        path: 'auth/callback',
        loadComponent: () => import('./pages/auth/new-password').then((c) => c.NewPasswordComponent)
      },
      {
        path: 'auth/otp',
        loadComponent: () => import('./pages/auth/otp').then((c) => c.OtpComponent)
      }
    ]
  },
  {
    path: 'app',
    component: AppLayout,
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard').then((c) => c.DashboardComponent),
        data: { breadcrumb: 'Dashboard' }
      },
      {
        path: 'profile',
        loadComponent: () => import('./pages/user/profile').then((c) => c.ProfileComponent),
        data: { breadcrumb: 'Profile' }
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/user/settings').then((c) => c.SettingsComponent),
        data: { breadcrumb: 'Settings' }
      }
      // Additional authenticated routes can be added here
    ]
  },
  { path: '**', redirectTo: 'login' } // Redirect all unknown routes to login
];
