import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CoinLinksDto } from '@chansey/api-interfaces';

interface ExternalLink {
  url: string;
  category: string;
  icon: string;
}

@Component({
  selector: 'app-external-links',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <h3 class="section-title mb-2 text-xl font-semibold md:mb-4 md:text-2xl">External Links</h3>
      <div class="flex flex-col gap-1">
        @for (link of allLinks(); track link.url) {
          <a
            [href]="link.url"
            target="_blank"
            rel="noopener noreferrer"
            class="group flex items-center justify-between border-b border-surface py-2.5 text-sm text-primary no-underline transition-colors last:border-b-0 hover:text-primary-emphasis"
          >
            <div class="flex min-w-0 items-center gap-2.5">
              <i [class]="'pi ' + link.icon" class="text-color-secondary shrink-0 text-base"></i>
              <span class="truncate group-hover:underline">{{ getDisplayUrl(link.url) }}</span>
            </div>
            <span
              class="text-color-secondary bg-surface-ground ml-4 shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide uppercase"
              >{{ link.category }}</span
            >
          </a>
        }
      </div>
    </div>
  `
})
export class ExternalLinksComponent {
  links = input<CoinLinksDto | null>(null);

  allLinks = computed(() => this.buildLinks(this.links()));

  private buildLinks(links: CoinLinksDto | null | undefined): ExternalLink[] {
    if (!links) return [];

    const result: ExternalLink[] = [];

    for (const url of links.homepage ?? []) {
      if (url) result.push({ url, category: 'Website', icon: 'pi-globe' });
    }

    let blockchainCount = 0;
    for (const url of links.blockchainSite ?? []) {
      if (url && blockchainCount < 3) {
        result.push({ url, category: 'Explorer', icon: 'pi-search' });
        blockchainCount++;
      }
    }

    if (links.subredditUrl) {
      result.push({ url: links.subredditUrl, category: 'Reddit', icon: 'pi-comments' });
    }

    for (const url of links.repositoryUrl ?? []) {
      if (url) result.push({ url, category: 'GitHub', icon: 'pi-github' });
    }

    let forumCount = 0;
    for (const url of links.officialForumUrl ?? []) {
      if (url && forumCount < 2) {
        result.push({ url, category: 'Forum', icon: 'pi-comment' });
        forumCount++;
      }
    }

    return result;
  }

  getDisplayUrl(url: string): string {
    if (!url) return '';

    let display = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (display.length > 40) {
      display = display.substring(0, 37) + '...';
    }
    return display;
  }
}
