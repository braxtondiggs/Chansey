import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';

import { RecentTransactionsComponent } from './recent-transactions.component';

import { TransactionsService } from '../../pages/transactions/transactions.service';

jest.mock(
  '@dicebear/collection',
  () => ({
    shapes: {}
  }),
  { virtual: true }
);

jest.mock(
  '@dicebear/core',
  () => ({
    createAvatar: jest.fn().mockReturnValue({
      toDataUriSync: jest.fn().mockReturnValue('data:image/svg+xml;utf8,<svg></svg>')
    })
  }),
  { virtual: true }
);

describe('RecentTransactionsComponent', () => {
  let component: RecentTransactionsComponent;
  let fixture: ComponentFixture<RecentTransactionsComponent>;
  let mockTransactionsService: { useTransactions: jest.Mock };

  beforeEach(async () => {
    mockTransactionsService = {
      useTransactions: jest.fn().mockReturnValue({
        data: jest.fn().mockReturnValue([]),
        refetch: jest.fn(),
        isPending: jest.fn().mockReturnValue(false),
        isFetching: jest.fn().mockReturnValue(false)
      })
    };

    await TestBed.configureTestingModule({
      imports: [RecentTransactionsComponent, RouterTestingModule, NoopAnimationsModule],
      providers: [{ provide: TransactionsService, useValue: mockTransactionsService }]
    }).compileComponents();

    fixture = TestBed.createComponent(RecentTransactionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
