import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-register-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full' },
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 600" fill="none" class="h-auto w-full">
      <defs>
        <linearGradient id="reg-growthGrad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" [attr.stop-color]="'var(--p-primary-300)'" />
          <stop offset="100%" [attr.stop-color]="'var(--p-primary-500)'" />
        </linearGradient>
        <linearGradient id="reg-growthFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" [attr.stop-color]="'var(--p-primary-400)'" stop-opacity="0.2" />
          <stop offset="100%" [attr.stop-color]="'var(--p-primary-400)'" stop-opacity="0.02" />
        </linearGradient>
        <linearGradient id="reg-iconGrad1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" [attr.stop-color]="'var(--p-primary-400)'" />
          <stop offset="100%" [attr.stop-color]="'var(--p-primary-600)'" />
        </linearGradient>
        <linearGradient id="reg-iconGrad2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" [attr.stop-color]="'var(--p-primary-300)'" />
          <stop offset="100%" [attr.stop-color]="'var(--p-primary-500)'" />
        </linearGradient>
        <filter id="reg-cardShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="4"
            stdDeviation="8"
            [attr.flood-color]="'var(--p-primary-500)'"
            flood-opacity="0.15"
          />
        </filter>
        <filter id="reg-smallShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="2"
            stdDeviation="4"
            [attr.flood-color]="'var(--p-primary-500)'"
            flood-opacity="0.1"
          />
        </filter>
      </defs>

      <!-- Main portfolio card -->
      <g filter="url(#reg-cardShadow)">
        <rect x="55" y="100" width="390" height="200" rx="20" fill="var(--p-surface-0)" fill-opacity="0.9" />
        <rect x="55" y="100" width="390" height="200" rx="20" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>

      <!-- Card header -->
      <text
        x="90"
        y="140"
        font-family="system-ui, sans-serif"
        font-size="14"
        font-weight="600"
        fill="var(--p-surface-900)"
      >
        Your Portfolio
      </text>
      <text x="90" y="160" font-family="system-ui, sans-serif" font-size="11" fill="var(--p-surface-500)">
        Track your growth
      </text>

      <!-- Portfolio value -->
      <text
        x="320"
        y="140"
        font-family="system-ui, sans-serif"
        font-size="20"
        font-weight="700"
        fill="var(--p-surface-900)"
        text-anchor="end"
      >
        $12,450
      </text>
      <text x="380" y="140" font-family="system-ui, sans-serif" font-size="11" fill="#48bb78" font-weight="500">
        +18.2%
      </text>

      <!-- Growth chart area -->
      <path
        d="M90,260 L130,250 L170,255 L210,235 L250,220 L290,200 L330,185 L370,175 L400,165 L400,275 L90,275 Z"
        fill="url(#reg-growthFill)"
      />
      <path
        d="M90,260 L130,250 L170,255 L210,235 L250,220 L290,200 L330,185 L370,175 L400,165"
        stroke="url(#reg-growthGrad)"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />

      <!-- Chart data points -->
      <circle cx="210" cy="235" r="3.5" fill="var(--p-surface-0)" stroke="var(--p-primary-500)" stroke-width="2" />
      <circle cx="290" cy="200" r="3.5" fill="var(--p-surface-0)" stroke="var(--p-primary-500)" stroke-width="2" />
      <circle cx="400" cy="165" r="4.5" fill="var(--p-primary-500)" stroke="var(--p-surface-0)" stroke-width="2" />

      <!-- Step 1: Account -->
      <g filter="url(#reg-smallShadow)">
        <rect x="40" y="340" width="130" height="100" rx="16" fill="var(--p-surface-0)" fill-opacity="0.95" />
        <rect x="40" y="340" width="130" height="100" rx="16" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>
      <circle cx="75" cy="372" r="18" fill="url(#reg-iconGrad1)" />
      <text
        x="75"
        y="378"
        font-family="system-ui, sans-serif"
        font-size="14"
        font-weight="700"
        fill="var(--p-primary-contrast-color)"
        text-anchor="middle"
      >
        1
      </text>
      <text
        x="105"
        y="376"
        font-family="system-ui, sans-serif"
        font-size="11"
        font-weight="600"
        fill="var(--p-surface-900)"
      >
        Account
      </text>
      <circle cx="145" cy="372" r="8" fill="#48bb78" fill-opacity="0.15" />
      <polyline
        points="140,372 143,375 150,368"
        fill="none"
        stroke="#48bb78"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="105" cy="410" r="8" fill="var(--p-primary-400)" fill-opacity="0.1" />
      <circle cx="105" cy="407" r="3" fill="var(--p-primary-500)" fill-opacity="0.4" />
      <path
        d="M99,415 C99,412 101,410 105,410 C109,410 111,412 111,415"
        fill="none"
        stroke="var(--p-primary-500)"
        stroke-width="1.2"
        stroke-opacity="0.4"
        stroke-linecap="round"
      />

      <!-- Step 2: Connect -->
      <g filter="url(#reg-smallShadow)">
        <rect x="185" y="340" width="130" height="100" rx="16" fill="var(--p-surface-0)" fill-opacity="0.95" />
        <rect x="185" y="340" width="130" height="100" rx="16" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>
      <circle cx="220" cy="372" r="18" fill="url(#reg-iconGrad2)" />
      <text
        x="220"
        y="378"
        font-family="system-ui, sans-serif"
        font-size="14"
        font-weight="700"
        fill="var(--p-primary-contrast-color)"
        text-anchor="middle"
      >
        2
      </text>
      <text
        x="250"
        y="376"
        font-family="system-ui, sans-serif"
        font-size="11"
        font-weight="600"
        fill="var(--p-surface-900)"
      >
        Connect
      </text>
      <g transform="translate(230, 400)">
        <path
          d="M8,12 L12,8 C14,6 18,6 20,8 L20,8 C22,10 22,14 20,16 L16,20"
          fill="none"
          stroke="var(--p-primary-500)"
          stroke-width="1.5"
          stroke-opacity="0.4"
          stroke-linecap="round"
        />
        <path
          d="M20,16 L16,20 C14,22 10,22 8,20 L8,20 C6,18 6,14 8,12 L12,8"
          fill="none"
          stroke="var(--p-primary-500)"
          stroke-width="1.5"
          stroke-opacity="0.4"
          stroke-linecap="round"
        />
      </g>

      <!-- Step 3: Trade -->
      <g filter="url(#reg-smallShadow)">
        <rect x="330" y="340" width="130" height="100" rx="16" fill="var(--p-surface-0)" fill-opacity="0.95" />
        <rect x="330" y="340" width="130" height="100" rx="16" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>
      <circle cx="365" cy="372" r="18" fill="url(#reg-iconGrad1)" />
      <text
        x="365"
        y="378"
        font-family="system-ui, sans-serif"
        font-size="14"
        font-weight="700"
        fill="var(--p-primary-contrast-color)"
        text-anchor="middle"
      >
        3
      </text>
      <text
        x="395"
        y="376"
        font-family="system-ui, sans-serif"
        font-size="11"
        font-weight="600"
        fill="var(--p-surface-900)"
      >
        Trade
      </text>
      <g transform="translate(370, 400)">
        <rect x="0" y="12" width="6" height="16" rx="2" fill="var(--p-primary-500)" fill-opacity="0.3" />
        <rect x="10" y="6" width="6" height="22" rx="2" fill="var(--p-primary-500)" fill-opacity="0.4" />
        <rect x="20" y="0" width="6" height="28" rx="2" fill="var(--p-primary-500)" fill-opacity="0.5" />
      </g>

      <!-- Bottom progress bar -->
      <g filter="url(#reg-smallShadow)">
        <rect x="100" y="475" width="300" height="50" rx="14" fill="var(--p-surface-0)" fill-opacity="0.95" />
        <rect x="100" y="475" width="300" height="50" rx="14" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>
      <text
        x="130"
        y="505"
        font-family="system-ui, sans-serif"
        font-size="11"
        font-weight="600"
        fill="var(--p-surface-900)"
      >
        Getting Started
      </text>
      <rect x="260" y="495" width="120" height="8" rx="4" fill="var(--p-surface-200)" />
      <rect x="260" y="495" width="40" height="8" rx="4" fill="url(#reg-growthGrad)" />
      <text x="260" y="490" font-family="system-ui, sans-serif" font-size="9" fill="var(--p-surface-500)">33%</text>

      <!-- Floating decorative elements -->
      <circle cx="430" cy="60" r="30" fill="var(--p-primary-400)" fill-opacity="0.08" />
      <circle cx="430" cy="60" r="16" fill="var(--p-primary-400)" fill-opacity="0.08" />
      <circle cx="60" cy="55" r="4" fill="var(--p-primary-400)" fill-opacity="0.15" />
      <circle cx="80" cy="45" r="3" fill="var(--p-primary-400)" fill-opacity="0.1" />
      <circle cx="45" cy="75" r="2.5" fill="var(--p-primary-400)" fill-opacity="0.12" />
      <circle cx="60" cy="560" r="20" fill="var(--p-primary-400)" fill-opacity="0.06" />
      <circle cx="440" cy="555" r="25" fill="var(--p-primary-400)" fill-opacity="0.06" />

      <!-- Growth arrow icon top -->
      <g transform="translate(80, 40)">
        <circle cx="20" cy="20" r="18" fill="var(--p-primary-400)" fill-opacity="0.1" />
        <path
          d="M20,10 L20,30 M14,18 L20,10 L26,18"
          fill="none"
          stroke="var(--p-primary-500)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-opacity="0.5"
        />
      </g>

      <!-- Star decorative -->
      <g transform="translate(450, 130)">
        <path
          d="M10,0 L12,7 L20,7 L14,12 L16,20 L10,15 L4,20 L6,12 L0,7 L8,7 Z"
          fill="var(--p-primary-400)"
          fill-opacity="0.1"
        />
      </g>
    </svg>
  `
})
export class RegisterIllustrationComponent {}
