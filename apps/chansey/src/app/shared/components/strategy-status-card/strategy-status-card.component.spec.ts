import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { PipelineStage, PipelineStatus, type UserPipelineStatus } from '@chansey/api-interfaces';

import { StrategyStatusCardComponent } from './strategy-status-card.component';

import { PipelineService } from '../../services/pipeline.service';

describe('StrategyStatusCardComponent', () => {
  let fixture: ComponentFixture<StrategyStatusCardComponent>;
  let component: StrategyStatusCardComponent;
  let statusSignal: ReturnType<typeof signal<UserPipelineStatus | null>>;

  const baseStatus: UserPipelineStatus = {
    pipelineId: 'p1',
    strategyName: 'Test Strategy',
    currentStage: PipelineStage.PAPER_TRADE,
    status: PipelineStatus.RUNNING,
    stageIndex: 3,
    totalStages: 5,
    createdAt: new Date().toISOString(),
    minDaysRemaining: 3,
    maxDaysRemaining: 7,
    isStalled: false,
    wasRejected: false,
    isRetrying: false
  };

  beforeEach(async () => {
    statusSignal = signal<UserPipelineStatus | null>(baseStatus);

    await TestBed.configureTestingModule({
      imports: [StrategyStatusCardComponent, NoopAnimationsModule],
      providers: [
        {
          provide: PipelineService,
          useValue: {
            usePipelineStatus: () => ({
              data: statusSignal
            })
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(StrategyStatusCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the retry panel when isRetrying is true', () => {
    statusSignal.set({
      ...baseStatus,
      status: PipelineStatus.COMPLETED,
      currentStage: PipelineStage.COMPLETED,
      stageIndex: 4,
      isRetrying: true,
      retryReason: "Strategy couldn't find enough opportunities"
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("We're trying again with different settings");
    expect(text).not.toContain("didn't pass the safety review");
    expect(component.etaLabel()).toBe('');
  });

  it('renders the rejected panel when wasRejected is true', () => {
    statusSignal.set({
      ...baseStatus,
      status: PipelineStatus.REJECTED,
      wasRejected: true,
      rejectionReason: 'Test rejected reason'
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("didn't pass the safety review");
    expect(text).not.toContain("We're retrying");
  });

  it('opens the dialog when openLearnMore is called and exposes stage content', () => {
    statusSignal.set({ ...baseStatus, currentStage: PipelineStage.OPTIMIZE, stageIndex: 0 });
    fixture.detectChanges();

    expect(component.dialogVisible()).toBe(false);

    component.openLearnMore();

    expect(component.dialogVisible()).toBe(true);
    const learnMore = component.currentLearnMore();
    if (!learnMore) throw new Error('expected learn-more content for OPTIMIZE stage');
    expect(learnMore.title).toContain('Training');
    expect(learnMore.bullets.length).toBeGreaterThan(0);
  });

  it('returns PAPER_TRADE-specific learn-more content', () => {
    statusSignal.set({ ...baseStatus, currentStage: PipelineStage.PAPER_TRADE, stageIndex: 3 });
    fixture.detectChanges();

    const learnMore = component.currentLearnMore();
    if (!learnMore) throw new Error('expected learn-more content for PAPER_TRADE stage');
    expect(learnMore.title).toContain('Paper Trading');
    expect(learnMore.bullets.some((b) => b.title.includes('pretend money'))).toBe(true);
  });

  it('closeLearnMore sets dialogVisible to false', () => {
    component.openLearnMore();
    expect(component.dialogVisible()).toBe(true);

    component.closeLearnMore();
    expect(component.dialogVisible()).toBe(false);
  });
});
