import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BullBoardComponent } from './bull-board.component';

describe('BullBoardComponent', () => {
  let component: BullBoardComponent;
  let fixture: ComponentFixture<BullBoardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BullBoardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(BullBoardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
