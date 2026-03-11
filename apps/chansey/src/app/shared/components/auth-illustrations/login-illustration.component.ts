import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-login-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full' },
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 560" fill="none" class="h-auto w-full">
      <defs>
        <linearGradient id="login-chartGrad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" [attr.stop-color]="'var(--p-primary-300)'" />
          <stop offset="100%" [attr.stop-color]="'var(--p-primary-500)'" />
        </linearGradient>
        <linearGradient id="login-chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" [attr.stop-color]="'var(--p-primary-400)'" stop-opacity="0.3" />
          <stop offset="100%" [attr.stop-color]="'var(--p-primary-400)'" stop-opacity="0.02" />
        </linearGradient>
        <linearGradient id="login-accentGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" [attr.stop-color]="'var(--p-primary-400)'" />
          <stop offset="100%" [attr.stop-color]="'var(--p-primary-600)'" />
        </linearGradient>
        <filter id="login-cardShadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow
            dx="0"
            dy="6"
            stdDeviation="12"
            [attr.flood-color]="'var(--p-primary-500)'"
            flood-opacity="0.12"
          />
        </filter>
        <filter id="login-chipShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="3"
            stdDeviation="6"
            [attr.flood-color]="'var(--p-primary-500)'"
            flood-opacity="0.1"
          />
        </filter>
      </defs>

      <!-- Decorative background rings -->
      <circle
        cx="240"
        cy="280"
        r="220"
        fill="none"
        stroke="var(--p-primary-400)"
        stroke-width="0.5"
        stroke-opacity="0.08"
      />
      <circle
        cx="240"
        cy="280"
        r="170"
        fill="none"
        stroke="var(--p-primary-400)"
        stroke-width="0.5"
        stroke-opacity="0.06"
      />

      <!-- Main dashboard card -->
      <g filter="url(#login-cardShadow)">
        <rect x="40" y="100" width="400" height="320" rx="24" fill="var(--p-surface-0)" fill-opacity="0.92" />
        <rect x="40" y="100" width="400" height="320" rx="24" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>

      <!-- Card header section -->
      <text
        x="80"
        y="148"
        font-family="system-ui, sans-serif"
        font-size="12"
        font-weight="500"
        fill="var(--p-surface-500)"
      >
        Portfolio Value
      </text>
      <text
        x="80"
        y="178"
        font-family="system-ui, sans-serif"
        font-size="28"
        font-weight="700"
        fill="var(--p-surface-900)"
      >
        $48,352
      </text>

      <!-- Gain badge -->
      <rect x="248" y="157" width="72" height="26" rx="13" fill="var(--p-primary-500)" fill-opacity="0.1" />
      <text
        x="284"
        y="174"
        font-family="system-ui, sans-serif"
        font-size="11"
        font-weight="600"
        fill="var(--p-primary-500)"
        text-anchor="middle"
      >
        +12.4%
      </text>

      <!-- Subtle divider -->
      <line x1="80" y1="198" x2="400" y2="198" stroke="var(--p-surface-100)" stroke-width="1" />

      <!-- Smooth area chart -->
      <path
        d="M80,360 C110,355 130,340 160,330 C190,320 210,335 240,310 C270,285 290,275 320,260 C350,245 370,230 400,215 L400,385 L80,385 Z"
        fill="url(#login-chartFill)"
      />
      <path
        d="M80,360 C110,355 130,340 160,330 C190,320 210,335 240,310 C270,285 290,275 320,260 C350,245 370,230 400,215"
        stroke="url(#login-chartGrad)"
        stroke-width="2.5"
        stroke-linecap="round"
        fill="none"
      />

      <!-- Active data point with pulse ring -->
      <circle cx="320" cy="260" r="12" fill="var(--p-primary-400)" fill-opacity="0.1" />
      <circle cx="320" cy="260" r="5" fill="var(--p-surface-0)" stroke="var(--p-primary-500)" stroke-width="2.5" />

      <!-- Endpoint glow -->
      <circle cx="400" cy="215" r="4" fill="var(--p-primary-500)" />

      <!-- Time period tabs -->
      <g transform="translate(80, 210)">
        <rect x="0" y="0" width="36" height="22" rx="6" fill="var(--p-primary-500)" fill-opacity="0.1" />
        <text
          x="18"
          y="15"
          font-family="system-ui, sans-serif"
          font-size="9"
          font-weight="600"
          fill="var(--p-primary-500)"
          text-anchor="middle"
        >
          1W
        </text>
        <text
          x="56"
          y="15"
          font-family="system-ui, sans-serif"
          font-size="9"
          font-weight="500"
          fill="var(--p-surface-400)"
          text-anchor="middle"
        >
          1M
        </text>
        <text
          x="86"
          y="15"
          font-family="system-ui, sans-serif"
          font-size="9"
          font-weight="500"
          fill="var(--p-surface-400)"
          text-anchor="middle"
        >
          3M
        </text>
        <text
          x="116"
          y="15"
          font-family="system-ui, sans-serif"
          font-size="9"
          font-weight="500"
          fill="var(--p-surface-400)"
          text-anchor="middle"
        >
          1Y
        </text>
      </g>

      <!-- Floating stat chip - top right -->
      <g filter="url(#login-chipShadow)">
        <rect x="320" y="50" width="140" height="56" rx="16" fill="var(--p-surface-0)" fill-opacity="0.95" />
        <rect x="320" y="50" width="140" height="56" rx="16" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>
      <circle cx="350" cy="78" r="14" fill="url(#login-accentGrad)" fill-opacity="0.15" />
      <path
        d="M344,78 L350,72 L356,78 M350,72 L350,84"
        fill="none"
        stroke="var(--p-primary-500)"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <text
        x="372"
        y="74"
        font-family="system-ui, sans-serif"
        font-size="10"
        font-weight="500"
        fill="var(--p-surface-500)"
      >
        Today
      </text>
      <text
        x="372"
        y="90"
        font-family="system-ui, sans-serif"
        font-size="13"
        font-weight="700"
        fill="var(--p-surface-900)"
      >
        +$1,240
      </text>

      <!-- Floating asset pill - bottom left -->
      <g filter="url(#login-chipShadow)">
        <rect x="20" y="445" width="180" height="52" rx="26" fill="var(--p-surface-0)" fill-opacity="0.95" />
        <rect x="20" y="445" width="180" height="52" rx="26" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>
      <circle cx="52" cy="471" r="16" fill="url(#login-accentGrad)" />
      <text
        x="52"
        y="477"
        font-family="system-ui, sans-serif"
        font-size="12"
        font-weight="700"
        fill="var(--p-primary-contrast-color)"
        text-anchor="middle"
      >
        B
      </text>
      <text
        x="80"
        y="466"
        font-family="system-ui, sans-serif"
        font-size="11"
        font-weight="600"
        fill="var(--p-surface-900)"
      >
        Bitcoin
      </text>
      <text x="80" y="482" font-family="system-ui, sans-serif" font-size="10" fill="#48bb78" font-weight="500">
        +5.23%
      </text>
      <polyline
        points="148,478 156,474 164,477 172,471 180,468"
        fill="none"
        stroke="#48bb78"
        stroke-width="1.5"
        stroke-linecap="round"
      />

      <!-- Floating asset pill - bottom right -->
      <g filter="url(#login-chipShadow)">
        <rect x="220" y="455" width="170" height="52" rx="26" fill="var(--p-surface-0)" fill-opacity="0.95" />
        <rect x="220" y="455" width="170" height="52" rx="26" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>
      <circle cx="252" cy="481" r="16" fill="var(--p-primary-400)" fill-opacity="0.2" />
      <path d="M252,469 L259,481 L252,485 L245,481 Z" fill="var(--p-primary-500)" fill-opacity="0.7" />
      <path d="M252,485 L259,481 L252,489 L245,481 Z" fill="var(--p-primary-500)" fill-opacity="0.4" />
      <text
        x="278"
        y="476"
        font-family="system-ui, sans-serif"
        font-size="11"
        font-weight="600"
        fill="var(--p-surface-900)"
      >
        Ethereum
      </text>
      <text x="278" y="492" font-family="system-ui, sans-serif" font-size="10" fill="#48bb78" font-weight="500">
        +3.17%
      </text>
      <polyline
        points="348,488 356,484 364,487 372,482"
        fill="none"
        stroke="#48bb78"
        stroke-width="1.5"
        stroke-linecap="round"
      />

      <!-- Subtle decorative dots -->
      <circle cx="60" cy="60" r="3" fill="var(--p-primary-400)" fill-opacity="0.12" />
      <circle cx="80" cy="48" r="2" fill="var(--p-primary-400)" fill-opacity="0.08" />
      <circle cx="45" cy="80" r="2" fill="var(--p-primary-400)" fill-opacity="0.1" />

      <!-- Bottom decorative -->
      <circle cx="420" cy="530" r="20" fill="var(--p-primary-400)" fill-opacity="0.05" />
      <circle cx="60" cy="530" r="15" fill="var(--p-primary-400)" fill-opacity="0.05" />
    </svg>
  `
})
export class LoginIllustrationComponent {}
