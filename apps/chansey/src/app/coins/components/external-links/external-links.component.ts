import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CoinLinksDto } from '@chansey/api-interfaces';

/**
 * T028: ExternalLinksComponent
 *
 * Displays external resource links for a cryptocurrency.
 * Features:
 * - Grouped by category (Website, Blockchain Explorer, GitHub, Reddit, Forum)
 * - Opens links in new tab with security attributes
 * - Gracefully handles missing/empty link arrays
 * - Icon-based visual representation
 */
@Component({
  selector: 'app-external-links',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="external-links-container">
      <h3 class="section-title">External Links</h3>

      <div class="links-grid">
        <!-- Homepage Links -->
        @if (links?.homepage && links!.homepage.length > 0) {
          <div class="link-group">
            <div class="link-group-title">
              <i class="pi pi-globe"></i>
              <span>Website</span>
            </div>
            @for (url of links!.homepage; track url; let i = $index) {
              @if (url) {
                <a
                  [href]="url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="external-link"
                  data-testid="link-homepage"
                >
                  {{ getDisplayUrl(url) }}
                  <i class="pi pi-external-link ml-2"></i>
                </a>
              }
            }
          </div>
        }

        <!-- Blockchain Explorer Links -->
        @if (links?.blockchainSite && links!.blockchainSite.length > 0) {
          <div class="link-group">
            <div class="link-group-title">
              <i class="pi pi-search"></i>
              <span>Blockchain Explorer</span>
            </div>
            @for (url of links!.blockchainSite; track url; let i = $index) {
              @if (url && i < 3) {
                <a
                  [href]="url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="external-link"
                  data-testid="link-blockchain"
                >
                  {{ getDisplayUrl(url) }}
                  <i class="pi pi-external-link ml-2"></i>
                </a>
              }
            }
          </div>
        }

        <!-- Reddit Link -->
        @if (links?.subredditUrl) {
          <div class="link-group">
            <div class="link-group-title">
              <i class="pi pi-comments"></i>
              <span>Reddit</span>
            </div>
            <a
              [href]="links!.subredditUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="external-link"
              data-testid="link-subreddit"
            >
              {{ getDisplayUrl(links!.subredditUrl!) }}
              <i class="pi pi-external-link ml-2"></i>
            </a>
          </div>
        }

        <!-- Repository Links -->
        @if (links?.repositoryUrl && links!.repositoryUrl.length > 0) {
          <div class="link-group">
            <div class="link-group-title">
              <i class="pi pi-github"></i>
              <span>GitHub</span>
            </div>
            @for (url of links!.repositoryUrl; track url; let i = $index) {
              @if (url) {
                <a
                  [href]="url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="external-link"
                  data-testid="link-repository"
                >
                  {{ getDisplayUrl(url) }}
                  <i class="pi pi-external-link ml-2"></i>
                </a>
              }
            }
          </div>
        }

        <!-- Official Forum Links -->
        @if (links?.officialForumUrl && links!.officialForumUrl.length > 0) {
          <div class="link-group">
            <div class="link-group-title">
              <i class="pi pi-comment"></i>
              <span>Forum</span>
            </div>
            @for (url of links!.officialForumUrl; track url; let i = $index) {
              @if (url && i < 2) {
                <a [href]="url" target="_blank" rel="noopener noreferrer" class="external-link">
                  {{ getDisplayUrl(url) }}
                  <i class="pi pi-external-link ml-2"></i>
                </a>
              }
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .external-links-container {
        padding: 1rem 0;
      }

      .section-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-color);
        margin-bottom: 1rem;
      }

      .links-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 1.5rem;
      }

      .link-group {
        .link-group-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-color-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 0.75rem;

          i {
            font-size: 1rem;
          }
        }

        .external-link {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 0;
          color: var(--primary-color);
          text-decoration: none;
          font-size: 0.875rem;
          transition: color 0.2s;

          &:hover {
            color: var(--primary-color-emphasis);
            text-decoration: underline;
          }

          i {
            font-size: 0.75rem;
            opacity: 0.7;
          }
        }
      }

      @media (max-width: 768px) {
        .links-grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class ExternalLinksComponent {
  @Input() links?: CoinLinksDto | null;

  /**
   * Extract display-friendly URL (remove protocol, limit length)
   */
  getDisplayUrl(url: string): string {
    if (!url) return '';

    let display = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (display.length > 40) {
      display = display.substring(0, 37) + '...';
    }
    return display;
  }
}
