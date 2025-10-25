import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { TabViewModule } from 'primeng/tabview';

import { ComparisonDashboardComponent } from './comparison-dashboard.component';
import { HistoricalRunComponent } from './historical-run.component';
import { LiveReplayComponent } from './live-replay.component';

@Component({
  selector: 'app-backtesting-shell',
  standalone: true,
  imports: [CommonModule, TabViewModule, HistoricalRunComponent, LiveReplayComponent, ComparisonDashboardComponent],
  template: `
    <p-tabView>
      <p-tabPanel header="Historical">
        <app-historical-run />
      </p-tabPanel>
      <p-tabPanel header="Live Replay">
        <app-live-replay />
      </p-tabPanel>
      <p-tabPanel header="Comparison">
        <app-comparison-dashboard />
      </p-tabPanel>
    </p-tabView>
  `
})
export class BacktestingShellComponent {}
