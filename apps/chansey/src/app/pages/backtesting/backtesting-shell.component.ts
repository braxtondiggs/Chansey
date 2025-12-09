import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { TabsModule } from 'primeng/tabs';

import { ComparisonDashboardComponent } from './comparison-dashboard.component';
import { HistoricalRunComponent } from './historical-run.component';
import { LiveReplayComponent } from './live-replay.component';

@Component({
  selector: 'app-backtesting-shell',
  standalone: true,
  imports: [CommonModule, TabsModule, HistoricalRunComponent, LiveReplayComponent, ComparisonDashboardComponent],
  template: `
    <p-tabs value="historical">
      <p-tablist>
        <p-tab value="historical">Historical</p-tab>
        <p-tab value="live-replay">Live Replay</p-tab>
        <p-tab value="comparison">Comparison</p-tab>
      </p-tablist>
      <p-tabpanels>
        <p-tabpanel value="historical">
          <app-historical-run />
        </p-tabpanel>
        <p-tabpanel value="live-replay">
          <app-live-replay />
        </p-tabpanel>
        <p-tabpanel value="comparison">
          <app-comparison-dashboard />
        </p-tabpanel>
      </p-tabpanels>
    </p-tabs>
  `
})
export class BacktestingShellComponent {}
