import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { PipelineStage, UserPipelineStatus } from '@chansey/api-interfaces';

import { PipelineService } from '../../services/pipeline.service';

interface StageDisplay {
  stage: PipelineStage;
  label: string;
  description: string;
}

interface LearnMoreBullet {
  icon: string;
  title: string;
  body: string;
}

interface LearnMoreContent {
  title: string;
  bullets: LearnMoreBullet[];
}

const STAGE_DISPLAY: StageDisplay[] = [
  {
    stage: PipelineStage.OPTIMIZE,
    label: 'Training',
    description: "We're training your strategy on historical data."
  },
  {
    stage: PipelineStage.HISTORICAL,
    label: 'Historical Test',
    description: 'Testing against months of past market data.'
  },
  {
    stage: PipelineStage.LIVE_REPLAY,
    label: 'Recent Replay',
    description: 'Replaying the most recent market moves.'
  },
  {
    stage: PipelineStage.PAPER_TRADE,
    label: 'Paper Trading',
    description: 'Practicing with pretend money in real market conditions.'
  },
  {
    stage: PipelineStage.COMPLETED,
    label: 'Safety Review',
    description: 'Final checks before your strategy goes live.'
  }
];

const HISTORY_BULLET: LearnMoreBullet = {
  icon: 'pi pi-cog',
  title: 'We test against history',
  body: 'We run your strategy against months of past market data to make sure it has an edge. Takes a few days.'
};

const PAPER_BULLET: LearnMoreBullet = {
  icon: 'pi pi-chart-line',
  title: 'We practice with pretend money',
  body: 'Your strategy trades live markets but with fake money first. Usually 1 to 4 weeks, depending on how often your strategy trades.'
};

const SAFETY_BULLET: LearnMoreBullet = {
  icon: 'pi pi-shield',
  title: 'We do a final safety review',
  body: "If your strategy passes, you go live. If not, we'll tell you and try a different one — no silent waiting."
};

const EMAIL_BULLET: LearnMoreBullet = {
  icon: 'pi pi-envelope',
  title: "We'll email you at each milestone",
  body: "You don't need to watch. We'll reach out when something changes and your dashboard will always show where you are."
};

const STAGE_LEARN_MORE: Record<PipelineStage, LearnMoreContent> = {
  [PipelineStage.OPTIMIZE]: {
    title: "What's happening during Training",
    bullets: [HISTORY_BULLET, PAPER_BULLET, SAFETY_BULLET, EMAIL_BULLET]
  },
  [PipelineStage.HISTORICAL]: {
    title: "What's happening during Historical Test",
    bullets: [HISTORY_BULLET, PAPER_BULLET, SAFETY_BULLET, EMAIL_BULLET]
  },
  [PipelineStage.LIVE_REPLAY]: {
    title: "What's happening during Recent Replay",
    bullets: [HISTORY_BULLET, PAPER_BULLET, SAFETY_BULLET, EMAIL_BULLET]
  },
  [PipelineStage.PAPER_TRADE]: {
    title: "What's happening during Paper Trading",
    bullets: [PAPER_BULLET, SAFETY_BULLET, EMAIL_BULLET]
  },
  [PipelineStage.COMPLETED]: {
    title: "What's happening during Safety Review",
    bullets: [SAFETY_BULLET, EMAIL_BULLET]
  }
};

@Component({
  selector: 'app-strategy-status-card',
  standalone: true,
  imports: [ButtonModule, CardModule, DialogModule, MessageModule],
  templateUrl: './strategy-status-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StrategyStatusCardComponent {
  private readonly pipelineService = inject(PipelineService);

  readonly statusQuery = this.pipelineService.usePipelineStatus();

  readonly status = computed<UserPipelineStatus | null>(() => this.statusQuery.data() ?? null);

  readonly stages = STAGE_DISPLAY;

  readonly dialogVisible = signal(false);

  readonly currentStageDisplay = computed(() => {
    const data = this.status();
    if (!data) return null;
    return STAGE_DISPLAY.find((s) => s.stage === data.currentStage) ?? STAGE_DISPLAY[0];
  });

  readonly currentLearnMore = computed<LearnMoreContent | null>(() => {
    const data = this.status();
    if (!data) return null;
    return STAGE_LEARN_MORE[data.currentStage] ?? null;
  });

  readonly etaLabel = computed(() => {
    const data = this.status();
    if (!data) return '';
    if (data.wasRejected || data.isRetrying) return '';
    if (data.minDaysRemaining === 0 && data.maxDaysRemaining === 0) return 'Going live soon';
    if (data.minDaysRemaining === data.maxDaysRemaining) {
      return `Est. ${data.maxDaysRemaining} day${data.maxDaysRemaining === 1 ? '' : 's'} until live trading`;
    }
    return `Est. ${data.minDaysRemaining}–${data.maxDaysRemaining} days until live trading`;
  });

  readonly showCard = computed(() => this.status() !== null);

  isStageComplete(index: number): boolean {
    const data = this.status();
    if (!data) return false;
    return index < data.stageIndex;
  }

  isStageCurrent(index: number): boolean {
    const data = this.status();
    if (!data) return false;
    return index === data.stageIndex;
  }

  openLearnMore(): void {
    this.dialogVisible.set(true);
  }

  closeLearnMore(): void {
    this.dialogVisible.set(false);
  }
}
