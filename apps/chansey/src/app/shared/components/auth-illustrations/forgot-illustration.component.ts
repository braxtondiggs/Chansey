import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-forgot-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full' },
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 600" fill="none" class="h-auto w-full">
      <defs>
        <linearGradient id="forgot-shieldGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" [attr.stop-color]="'var(--p-primary-400)'" />
          <stop offset="100%" [attr.stop-color]="'var(--p-primary-600)'" />
        </linearGradient>
        <linearGradient id="forgot-lockGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" [attr.stop-color]="'var(--p-primary-300)'" />
          <stop offset="100%" [attr.stop-color]="'var(--p-primary-500)'" />
        </linearGradient>
        <filter id="forgot-mainShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="4"
            stdDeviation="8"
            [attr.flood-color]="'var(--p-primary-500)'"
            flood-opacity="0.15"
          />
        </filter>
        <filter id="forgot-softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="2"
            stdDeviation="4"
            [attr.flood-color]="'var(--p-primary-500)'"
            flood-opacity="0.1"
          />
        </filter>
      </defs>

      <!-- Central shield card -->
      <g filter="url(#forgot-mainShadow)">
        <rect x="100" y="110" width="300" height="280" rx="24" fill="var(--p-surface-0)" fill-opacity="0.9" />
        <rect x="100" y="110" width="300" height="280" rx="24" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>

      <!-- Shield icon -->
      <g transform="translate(200, 140)">
        <path
          d="M50,0 L95,20 L95,55 C95,85 78,108 50,120 C22,108 5,85 5,55 L5,20 Z"
          fill="var(--p-primary-400)"
          fill-opacity="0.12"
        />
        <path
          d="M50,0 L95,20 L95,55 C95,85 78,108 50,120 C22,108 5,85 5,55 L5,20 Z"
          fill="none"
          stroke="url(#forgot-shieldGrad)"
          stroke-width="2"
        />
        <polyline
          points="32,58 45,72 68,46"
          fill="none"
          stroke="var(--p-primary-500)"
          stroke-width="3.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </g>

      <!-- "Account Recovery" label -->
      <text
        x="250"
        y="290"
        font-family="system-ui, sans-serif"
        font-size="14"
        font-weight="600"
        fill="var(--p-surface-900)"
        text-anchor="middle"
      >
        Account Recovery
      </text>
      <text
        x="250"
        y="310"
        font-family="system-ui, sans-serif"
        font-size="11"
        fill="var(--p-surface-500)"
        text-anchor="middle"
      >
        Secure password reset
      </text>

      <!-- Progress steps -->
      <g transform="translate(140, 335)">
        <circle cx="0" cy="0" r="12" fill="url(#forgot-shieldGrad)" />
        <text
          x="0"
          y="4"
          font-family="system-ui, sans-serif"
          font-size="10"
          font-weight="700"
          fill="var(--p-primary-contrast-color)"
          text-anchor="middle"
        >
          1
        </text>
        <line x1="14" y1="0" x2="86" y2="0" stroke="var(--p-primary-500)" stroke-width="2" stroke-opacity="0.3" />
        <circle
          cx="100"
          cy="0"
          r="12"
          fill="var(--p-surface-0)"
          stroke="var(--p-primary-500)"
          stroke-width="1.5"
          stroke-opacity="0.4"
        />
        <text
          x="100"
          y="4"
          font-family="system-ui, sans-serif"
          font-size="10"
          font-weight="600"
          fill="var(--p-primary-400)"
          fill-opacity="0.5"
          text-anchor="middle"
        >
          2
        </text>
        <line x1="114" y1="0" x2="186" y2="0" stroke="var(--p-surface-200)" stroke-width="2" />
        <circle cx="200" cy="0" r="12" fill="var(--p-surface-0)" stroke="var(--p-surface-200)" stroke-width="1.5" />
        <text
          x="200"
          y="4"
          font-family="system-ui, sans-serif"
          font-size="10"
          font-weight="600"
          fill="var(--p-surface-500)"
          text-anchor="middle"
        >
          3
        </text>
        <text
          x="0"
          y="28"
          font-family="system-ui, sans-serif"
          font-size="9"
          fill="var(--p-primary-500)"
          font-weight="500"
          text-anchor="middle"
        >
          Email
        </text>
        <text
          x="100"
          y="28"
          font-family="system-ui, sans-serif"
          font-size="9"
          fill="var(--p-surface-500)"
          text-anchor="middle"
        >
          Verify
        </text>
        <text
          x="200"
          y="28"
          font-family="system-ui, sans-serif"
          font-size="9"
          fill="var(--p-surface-500)"
          text-anchor="middle"
        >
          Reset
        </text>
      </g>

      <!-- Email card bottom-left -->
      <g filter="url(#forgot-softShadow)">
        <rect x="40" y="430" width="195" height="80" rx="16" fill="var(--p-surface-0)" fill-opacity="0.95" />
        <rect x="40" y="430" width="195" height="80" rx="16" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>
      <circle cx="85" cy="470" r="22" fill="var(--p-primary-400)" fill-opacity="0.15" />
      <rect x="71" y="462" width="28" height="18" rx="3" fill="none" stroke="var(--p-primary-500)" stroke-width="1.5" />
      <polyline
        points="71,462 85,473 99,462"
        fill="none"
        stroke="var(--p-primary-500)"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <text
        x="120"
        y="465"
        font-family="system-ui, sans-serif"
        font-size="11"
        font-weight="600"
        fill="var(--p-surface-900)"
      >
        Reset Link Sent
      </text>
      <text x="120" y="482" font-family="system-ui, sans-serif" font-size="10" fill="var(--p-surface-500)">
        Check your inbox
      </text>

      <!-- Key card bottom-right -->
      <g filter="url(#forgot-softShadow)">
        <rect x="265" y="430" width="195" height="80" rx="16" fill="var(--p-surface-0)" fill-opacity="0.95" />
        <rect x="265" y="430" width="195" height="80" rx="16" stroke="var(--p-surface-200)" stroke-width="1" />
      </g>
      <circle cx="310" cy="470" r="22" fill="var(--p-primary-400)" fill-opacity="0.15" />
      <rect
        x="301"
        y="468"
        width="18"
        height="14"
        rx="3"
        fill="none"
        stroke="var(--p-primary-500)"
        stroke-width="1.5"
      />
      <path
        d="M305,468 L305,463 C305,459 307,457 310,457 C313,457 315,459 315,463 L315,468"
        fill="none"
        stroke="var(--p-primary-500)"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <circle cx="310" cy="475" r="2" fill="var(--p-primary-500)" />
      <text
        x="345"
        y="465"
        font-family="system-ui, sans-serif"
        font-size="11"
        font-weight="600"
        fill="var(--p-surface-900)"
      >
        Encrypted
      </text>
      <text x="345" y="482" font-family="system-ui, sans-serif" font-size="10" fill="var(--p-surface-500)">
        256-bit security
      </text>

      <!-- Floating decorative elements -->
      <circle cx="420" cy="70" r="32" fill="var(--p-primary-400)" fill-opacity="0.08" />
      <circle cx="420" cy="70" r="18" fill="var(--p-primary-400)" fill-opacity="0.08" />
      <circle cx="65" cy="60" r="4" fill="var(--p-primary-400)" fill-opacity="0.15" />
      <circle cx="85" cy="50" r="3" fill="var(--p-primary-400)" fill-opacity="0.1" />
      <circle cx="50" cy="80" r="2.5" fill="var(--p-primary-400)" fill-opacity="0.12" />
      <circle cx="80" cy="555" r="22" fill="var(--p-primary-400)" fill-opacity="0.06" />
      <circle cx="420" cy="560" r="28" fill="var(--p-primary-400)" fill-opacity="0.06" />

      <!-- Lock icon top-left -->
      <g transform="translate(50, 120)">
        <circle cx="18" cy="18" r="16" fill="var(--p-primary-400)" fill-opacity="0.08" />
        <rect
          x="11"
          y="18"
          width="14"
          height="10"
          rx="2.5"
          fill="none"
          stroke="var(--p-primary-500)"
          stroke-width="1.2"
          stroke-opacity="0.3"
        />
        <path
          d="M14,18 L14,14 C14,11 16,9 18,9 C20,9 22,11 22,14 L22,18"
          fill="none"
          stroke="var(--p-primary-500)"
          stroke-width="1.2"
          stroke-opacity="0.3"
          stroke-linecap="round"
        />
      </g>

      <!-- Key icon top-right -->
      <g transform="translate(400, 110)">
        <circle cx="18" cy="18" r="16" fill="var(--p-primary-400)" fill-opacity="0.08" />
        <circle
          cx="14"
          cy="18"
          r="5"
          fill="none"
          stroke="var(--p-primary-500)"
          stroke-width="1.2"
          stroke-opacity="0.3"
        />
        <line
          x1="19"
          y1="18"
          x2="28"
          y2="18"
          stroke="var(--p-primary-500)"
          stroke-width="1.2"
          stroke-opacity="0.3"
          stroke-linecap="round"
        />
        <line
          x1="25"
          y1="18"
          x2="25"
          y2="22"
          stroke="var(--p-primary-500)"
          stroke-width="1.2"
          stroke-opacity="0.3"
          stroke-linecap="round"
        />
      </g>

      <!-- Bottom shield decorative -->
      <g transform="translate(230, 530)">
        <circle cx="20" cy="20" r="18" fill="var(--p-primary-400)" fill-opacity="0.08" />
        <path
          d="M20,10 L30,16 L30,24 C30,30 26,34 20,36 C14,34 10,30 10,24 L10,16 Z"
          fill="none"
          stroke="var(--p-primary-500)"
          stroke-width="1.2"
          stroke-opacity="0.2"
        />
      </g>
    </svg>
  `
})
export class ForgotIllustrationComponent {}
