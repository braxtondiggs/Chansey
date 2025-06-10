import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';

import { createComponentFactory, mockProvider, Spectator } from '@ngneat/spectator/vitest';

import { RecentTransactionsComponent } from './recent-transactions.component';

import { TransactionsService } from '../../../pages/transactions/transactions.service';

describe('RecentTransactionsComponent', () => {
  let spectator: Spectator<RecentTransactionsComponent>;

  const mockTransactionsService = {
    useTransactions: vi.fn().mockReturnValue({
      data: vi.fn().mockReturnValue([]),
      refetch: vi.fn(),
      isPending: vi.fn().mockReturnValue(false),
      isFetching: vi.fn().mockReturnValue(false)
    })
  };

  const createComponent = createComponentFactory({
    component: RecentTransactionsComponent,
    imports: [NoopAnimationsModule],
    providers: [
      { provide: TransactionsService, useValue: mockTransactionsService },
      mockProvider(Router, {
        navigate: vi.fn()
      })
    ]
  });

  it('should create', () => {
    spectator = createComponent();
    expect(spectator.component).toBeTruthy();
  });
});
