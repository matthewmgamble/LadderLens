/**
 * Searchable call list panel.
 */

import type { Call } from '../model/types.js';
import { formatTime, formatRelativeTime } from '../parser/timestamp.js';

export interface CallListOptions {
  container: HTMLElement;
  onSelectCall: (call: Call) => void;
}

export class CallList {
  private container: HTMLElement;
  private onSelectCall: (call: Call) => void;
  private calls: Call[] = [];
  private filteredCalls: Call[] = [];
  private selectedCid: number | null = null;
  private searchQuery = '';
  private itemsContainer!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private countSpan!: HTMLElement;

  constructor(opts: CallListOptions) {
    this.container = opts.container;
    this.onSelectCall = opts.onSelectCall;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="call-list-header">
        <div class="call-list-title">Calls</div>
        <input type="text" class="call-list-search" placeholder="Search by number, CID, Call-ID..." id="callSearch">
        <div class="call-list-controls">
          <span class="call-count" id="callCount"></span>
        </div>
      </div>
      <div class="call-list-items" id="callListItems"></div>
    `;

    this.itemsContainer = this.container.querySelector('#callListItems')!;
    this.searchInput = this.container.querySelector('#callSearch') as HTMLInputElement;
    this.countSpan = this.container.querySelector('#callCount')!;
    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput.value.toLowerCase();
      this.applyFilter();
    });
  }

  setCalls(calls: Call[]): void {
    this.calls = calls;
    this.applyFilter();
  }

  private applyFilter(): void {
    this.filteredCalls = this.calls.filter(call => {
      // Hide OPTIONS sessions
      if (call.isOptions) return false;

      // Search filter
      if (this.searchQuery) {
        const q = this.searchQuery;
        const haystack = [
          call.callingNumber ?? '',
          call.calledNumber ?? '',
          String(call.cid),
          ...call.legs.map(l => l.callId),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    this.countSpan.textContent = `${this.filteredCalls.length} of ${this.calls.length}`;
    this.renderItems();
  }

  private renderItems(): void {
    this.itemsContainer.innerHTML = '';

    for (const call of this.filteredCalls) {
      const el = document.createElement('div');
      el.className = 'call-item' + (call.cid === this.selectedCid ? ' selected' : '');
      el.dataset.cid = String(call.cid);

      const time = formatTime(call.startTime);
      const from = call.callingNumber ?? 'Unknown';
      const to = call.calledNumber ?? 'Unknown';

      let badgeClass = 'badge-progress';
      let badgeText: string = call.status;
      if (call.status === 'success') { badgeClass = 'badge-success'; badgeText = '200 OK'; }
      else if (call.status === 'failed') { badgeClass = 'badge-failed'; badgeText = `${call.finalResponseCode ?? 'Error'}`; }
      else if (call.status === 'partial') { badgeClass = 'badge-partial'; badgeText = 'Partial'; }

      const dur = call.duration !== undefined && call.duration > 0
        ? formatRelativeTime(call.duration)
        : '';

      const findingsCount = call.findings.length;

      el.innerHTML = `
        <div class="call-item-row">
          <span class="call-item-time">${time}</span>
          <span class="call-item-numbers">
            ${escapeHtml(from)} <span class="call-item-arrow">&rarr;</span> ${escapeHtml(to)}
          </span>
        </div>
        <div class="call-item-meta">
          <span class="call-badge ${badgeClass}">${badgeText}</span>
          ${dur ? `<span class="call-item-duration">${dur}</span>` : ''}
          ${findingsCount > 0 ? `<span class="call-item-findings">${findingsCount} finding${findingsCount > 1 ? 's' : ''}</span>` : ''}
          <span class="call-item-duration" style="margin-left:auto">CID:${call.cid}</span>
        </div>
      `;

      el.addEventListener('click', () => {
        this.selectedCid = call.cid;
        this.renderItems();
        this.onSelectCall(call);
      });

      this.itemsContainer.appendChild(el);
    }
  }

  selectCall(cid: number): void {
    this.selectedCid = cid;
    this.renderItems();
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
