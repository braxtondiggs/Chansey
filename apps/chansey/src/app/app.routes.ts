import { Route } from '@angular/router';

import { AdminGuard } from './guard/admin.guard';
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
        data: { breadcrumb: 'Portfolio' }
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
      },
      {
        path: 'transactions',
        loadComponent: () => import('./pages/transactions').then((c) => c.TransactionsComponent),
        data: { breadcrumb: 'Transactions' }
      },
      {
        path: 'prices',
        loadComponent: () => import('./pages/prices').then((c) => c.PricesComponent),
        data: { breadcrumb: 'Prices' }
      },
      {
        path: 'watchlist',
        loadComponent: () => import('./pages/watchlist').then((c) => c.WatchlistComponent),
        data: { breadcrumb: 'Watchlist' }
      }
    ]
  },
  {
    path: 'admin',
    component: AppLayout,
    canActivate: [AuthGuard, AdminGuard],
    data: { breadcrumb: 'Admin' },
    children: [
      {
        path: '',
        redirectTo: '/app/dashboard',
        pathMatch: 'full'
      },
      {
        path: 'categories',
        loadComponent: () => import('./pages/admin/categories').then((c) => c.CategoriesComponent),
        data: { breadcrumb: 'Categories' }
      },
      {
        path: 'coins',
        loadComponent: () => import('./pages/admin/coins').then((c) => c.CoinsComponent),
        data: { breadcrumb: 'Coins' }
      },
      {
        path: 'exchanges',
        loadComponent: () => import('./pages/admin/exchanges').then((c) => c.ExchangesComponent),
        data: { breadcrumb: 'Exchanges' }
      },
      {
        path: 'risks',
        loadComponent: () => import('./pages/admin/risks').then((c) => c.RisksComponent),
        data: { breadcrumb: 'Risk Levels' }
      },
      {
        path: 'algorithms',
        loadComponent: () => import('./pages/admin/algorithms').then((c) => c.AlgorithmsComponent),
        data: { breadcrumb: 'Algorithms' }
      },
      {
        path: 'bull-board',
        loadComponent: () => import('./pages/admin/bull-board').then((c) => c.BullBoardComponent),
        data: { breadcrumb: 'Bull Board' }
      }
    ]
  },
  { path: '**', redirectTo: 'login' } // Redirect all unknown routes to login
];
