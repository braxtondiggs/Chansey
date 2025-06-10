import { createComponentFactory, Spectator } from '@ngneat/spectator/vitest';

import { BullBoardComponent } from './bull-board.component';

describe('BullBoardComponent', () => {
  let spectator: Spectator<BullBoardComponent>;
  const createComponent = createComponentFactory(BullBoardComponent);

  beforeEach(() => {
    spectator = createComponent();
  });

  it('should create', () => {
    expect(spectator.component).toBeTruthy();
  });
});
