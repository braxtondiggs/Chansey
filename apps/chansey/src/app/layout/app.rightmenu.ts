import { Component, inject } from '@angular/core';

import { DrawerModule } from 'primeng/drawer';

import { LayoutService } from '@chansey-web/app/shared/services/layout.service';

@Component({
  selector: 'app-rightmenu',
  standalone: true,
  imports: [DrawerModule],
  template: ` <p-drawer
    header="Menu"
    [(visible)]="rightMenuVisible"
    position="right"
    styleClass="layout-rightmenu !w-full sm:!w-[36rem]"
  >
    <div class="flex flex-col items-center justify-center p-8 text-center">
      <span
        class="border-surface flex h-20 w-20 items-center justify-center rounded-xl border shadow-[0px_1px_2px_0px_rgba(18,18,23,0.05)]"
      >
        <i class="pi pi-cog text-surface-400 !text-4xl"></i>
      </span>
      <h2 class="title-h6 mt-6">No Configuration Available</h2>
      <p class="body-small text-surface-600 dark:text-surface-400 mt-2 max-w-md">
        This menu will be populated with your activity feed and configuration options in the future.
      </p>
      <button pButton label="Close Menu" severity="secondary" class="mt-6" (click)="rightMenuVisible = false"></button>
    </div>

    <!-- Original content commented out for future reference
    <div>
      <h2 class="title-h7 text-left">Activity</h2>
      <div class="mt-7 flex flex-col">
        <div class="flex gap-6">
          <div class="flex flex-col items-center">
            <span
              class="border-surface flex h-14 w-14 items-center justify-center rounded-xl border shadow-[0px_1px_2px_0px_rgba(18,18,23,0.05);]"
            >
              <i class="pi pi-dollar !text-2xl text-blue-600"></i>
            </span>
            <span class="min-h-14 w-px bg-[var(--surface-border)]"></span>
          </div>
          <div class="mt-2">
            <h5 class="label-large">New Sale</h5>
            <p class="md:label-small mt-1">
              Richard Jones has purchased a blue t-shirt for
              <b class="body-small text-surface-950 dark:text-surface-0">$79</b>
            </p>
          </div>
        </div>
        <div class="flex gap-6">
          <div class="flex flex-col items-center">
            <span
              class="border-surface flex h-14 w-14 items-center justify-center rounded-xl border shadow-[0px_1px_2px_0px_rgba(18,18,23,0.05);]"
            >
              <i class="pi pi-download !text-2xl text-orange-600"></i>
            </span>
            <span class="min-h-14 w-px bg-[var(--surface-border)]"></span>
          </div>
          <div class="mt-2">
            <h5 class="label-large">Withdrawal Initiated</h5>
            <p class="md:label-small mt-1">
              Your request for withdrawal of
              <b class="body-small text-surface-950 dark:text-surface-0">$2500</b> has been initiated.
            </p>
          </div>
        </div>
        <div class="flex gap-6">
          <div class="flex flex-col items-center">
            <span
              class="border-surface flex h-14 w-14 items-center justify-center rounded-xl border shadow-[0px_1px_2px_0px_rgba(18,18,23,0.05);]"
            >
              <i class="pi pi-question-circle !text-2xl text-violet-600"></i>
            </span>
            <span class="min-h-14 w-px bg-[var(--surface-border)]"></span>
          </div>
          <div class="mt-2">
            <h5 class="label-large">Question Received</h5>
            <p class="md:label-small mt-1">
              Jane Davis has posted a
              <b class="body-small text-surface-950 dark:text-surface-0">new question</b> about your product.
            </p>
          </div>
        </div>
        <div class="flex gap-6">
          <div class="flex flex-col items-center">
            <span
              class="border-surface flex h-14 w-14 items-center justify-center rounded-xl border shadow-[0px_1px_2px_0px_rgba(18,18,23,0.05);]"
            >
              <i class="pi pi-comment !text-2xl text-blue-600"></i>
            </span>
          </div>
          <div class="mt-2">
            <h5 class="label-large">Comment Received</h5>
            <p class="md:label-small mt-1">
              Claire Smith has upvoted your store along with a
              <b class="body-small text-surface-950 dark:text-surface-0">comment.</b>
            </p>
          </div>
        </div>
      </div>
    </div>
    <p-divider class="!my-10" />
    <div>
      <h2 class="title-h7 text-left">Quick Withdraw</h2>
      <div class="mb-6 mt-7 flex flex-col gap-3.5">
        <input pInputText type="text" [(ngModel)]="amountValue" placeholder="Amount" />
        <p-select
          [(ngModel)]="selectedCard"
          [options]="cards"
          optionLabel="label"
          placeholder="Select a Card"
          class="w-full"
        />
      </div>
      <button pButton label="Confirm" severity="success" class="!w-full"></button>
    </div>
    <p-divider class="!my-10" />
    <div>
      <h2 class="title-h7 text-left">Shipment Tracking</h2>
      <p class="body-small mt-1 text-left">Track your ongoing shipments to customers.</p>
      <img
        class="border-surface mt-4 h-full max-h-60 w-full rounded-2xl border object-cover"
        src="/layout/images/sidebar-right/staticmap.png"
        alt="diamond-vue"
      />
    </div>
    -->
  </p-drawer>`
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppRightMenu {
  layoutService: LayoutService = inject(LayoutService);

  cards = [
    { label: '*****24', value: { id: 1, name: '*****24', code: 'A1' } },
    { label: '*****75', value: { id: 2, name: '*****75', code: 'A2' } }
  ];

  selectedCard: any;
  amountValue = '';

  get rightMenuVisible(): boolean {
    return this.layoutService.layoutState().rightMenuVisible;
  }

  set rightMenuVisible(_val: boolean) {
    this.layoutService.layoutState.update((prev) => ({ ...prev, rightMenuVisible: _val }));
  }
}
