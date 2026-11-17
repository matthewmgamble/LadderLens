/**
 * Top-level app layout and state management.
 *
 * Three-panel layout:
 * - Left: Call list (searchable)
 * - Center: SVG call ladder
 * - Right: Message detail inspector
 */

import type { Call, ParseResult, SipMessage } from '../model/types.js';
import { FileDrop } from './file-drop.js';
import { CallList } from './call-list.js';
import { Ladder } from './ladder.js';
import { MessageDetail } from './message-detail.js';
import { runFindings } from '../analysis/findings.js';
import { exportSvg, exportPng, exportJson, exportMarkdown, exportHtmlReport } from '../export/index.js';

export class App {
  private root: HTMLElement;
  private state: {
    result: ParseResult | null;
    selectedCall: Call | null;
    selectedMessage: SipMessage | null;
  } = {
    result: null,
    selectedCall: null,
    selectedMessage: null,
  };

  private callList!: CallList;
  private ladder!: Ladder;
  private messageDetail!: MessageDetail;
  private documentClickHandler: ((e: MouseEvent) => void) | null = null;
  private exportBtnHandler: ((e: MouseEvent) => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.renderInitial();
  }

  private renderInitial(): void {
    this.cleanupExportListeners();
    this.root.innerHTML = `
      <header class="app-header">
        <span class="app-title">LadderLens</span>
        <span class="app-subtitle">Ribbon SBC Call Ladder Viewer</span>
        <div class="header-actions" id="headerActions">
          <a href="https://github.com/matthewmgamble/LadderLens" target="_blank" rel="noopener noreferrer" class="header-link">GitHub</a>
        </div>
      </header>
      <div class="app-body" id="appBody">
        <div class="landing-page" id="landingPage">
          <div class="landing-hero">
            <h1 class="landing-title">Ribbon SBC Call Flow Viewer</h1>
            <p class="landing-tagline">Visualize and troubleshoot SIP signaling from diagnostic exports — entirely in your browser</p>
          </div>

          <div class="file-drop-container" id="fileDropContainer"></div>

          <div class="landing-features">
            <div class="feature-card">
              <div class="feature-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <div class="feature-text">
                <strong>100% Local Processing</strong>
                <span>Your log files never leave your machine. All parsing and analysis happens entirely in your browser — no server, no uploads, no data collection.</span>
              </div>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
              </div>
              <div class="feature-text">
                <strong>Interactive Call Ladders</strong>
                <span>Correlates ingress and egress legs by CID, renders SVG call flow diagrams, and lets you inspect every SIP message, header, and SDP body.</span>
              </div>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </div>
              <div class="feature-text">
                <strong>Automated Troubleshooting</strong>
                <span>Flags error responses, timeouts, retransmissions, codec mismatches, and number rewrites with contextual explanations.</span>
              </div>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div class="feature-text">
                <strong>Export & Share</strong>
                <span>Download call ladders as SVG, PNG, HTML reports, JSON data, or Markdown summaries. Built-in redaction strips sensitive fields before sharing.</span>
              </div>
            </div>
          </div>

          <div class="landing-compat">
            <p class="compat-title">Supported Formats</p>
            <p class="compat-text">Ribbon SBC SWe 11.x and 13.x WebUI diagnostic exports. Handles files up to 200MB with streaming parsing.</p>
          </div>

          <div class="landing-footer">
            <p>A free and open-source tool by <a href="https://mgamble.ca" target="_blank" rel="noopener">Matthew Gamble</a></p>
            <p><a href="https://github.com/matthewmgamble/LadderLens" target="_blank" rel="noopener">View on GitHub</a></p>
          </div>
        </div>
      </div>
    `;

    const container = this.root.querySelector('#fileDropContainer') as HTMLElement;
    new FileDrop({
      container,
      onComplete: (result) => this.onParseComplete(result),
      onError: (msg) => console.error('Parse error:', msg),
    });
  }

  private onParseComplete(result: ParseResult): void {
    // Run findings on each call
    for (const call of result.calls) {
      call.findings = runFindings(call);
    }

    this.state.result = result;
    this.state.selectedCall = null;
    this.state.selectedMessage = null;
    this.renderWorkspace();
  }

  private renderWorkspace(): void {
    const result = this.state.result;
    if (!result) return;

    this.cleanupExportListeners();

    // Build workspace layout
    const body = this.root.querySelector('#appBody') as HTMLElement;
    body.innerHTML = `
      <div class="call-list-panel" id="callListPanel"></div>
      <div class="ladder-panel" id="ladderPanel">
        <div class="ladder-header" id="ladderHeader">
          <span class="ladder-call-info" id="ladderCallInfo">Select a call</span>
          <div class="ladder-toolbar" id="ladderToolbar"></div>
        </div>
        <div class="ladder-container" id="ladderContainer"></div>
      </div>
      <div class="detail-panel" id="detailPanel" style="display:none"></div>
    `;

    // Add header buttons
    const headerActions = this.root.querySelector('#headerActions') as HTMLElement;
    headerActions.innerHTML = `
      <button class="btn btn-sm" id="newFileBtn">New File</button>
      <div class="export-wrapper">
        <button class="btn btn-sm" id="exportBtn" style="display:none">Export</button>
        <div class="export-menu" id="exportMenu" style="display:none">
          <button class="export-menu-item" data-format="svg">SVG Diagram</button>
          <button class="export-menu-item" data-format="png">PNG Image</button>
          <button class="export-menu-item" data-format="html">HTML Report</button>
          <button class="export-menu-item" data-format="json">JSON Data</button>
          <button class="export-menu-item" data-format="markdown">Markdown Summary</button>
        </div>
      </div>
    `;

    this.root.querySelector('#newFileBtn')!.addEventListener('click', () => {
      this.state.result = null;
      this.renderInitial();
    });

    // Set up export button toggle — once, not per call selection
    const exportBtn = this.root.querySelector('#exportBtn') as HTMLElement;
    const menu = this.root.querySelector('#exportMenu') as HTMLElement;

    this.exportBtnHandler = (e: MouseEvent) => {
      e.stopPropagation();
      const isOpen = menu.style.display !== 'none';
      menu.style.display = isOpen ? 'none' : '';
    };
    exportBtn.addEventListener('click', this.exportBtnHandler);

    // Close menu on outside click
    this.documentClickHandler = (e: MouseEvent) => {
      // Don't close if clicking inside the menu (item clicks handle themselves)
      if (menu.contains(e.target as Node)) return;
      menu.style.display = 'none';
    };
    document.addEventListener('click', this.documentClickHandler);

    // Export menu item clicks
    menu.querySelectorAll('.export-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const format = (item as HTMLElement).dataset.format!;
        const call = this.state.selectedCall;
        if (call) this.doExport(call, format);
        menu.style.display = 'none';
      });
    });

    // Initialize panels
    this.callList = new CallList({
      container: body.querySelector('#callListPanel')!,
      onSelectCall: (call) => this.onSelectCall(call),
    });

    this.ladder = new Ladder({
      container: body.querySelector('#ladderContainer')!,
      onSelectMessage: (msg) => this.onSelectMessage(msg),
    });

    this.messageDetail = new MessageDetail({
      container: body.querySelector('#detailPanel')!,
      onClose: () => {
        this.state.selectedMessage = null;
      },
    });

    this.callList.setCalls(result.calls);
  }

  private cleanupExportListeners(): void {
    if (this.documentClickHandler) {
      document.removeEventListener('click', this.documentClickHandler);
      this.documentClickHandler = null;
    }
    this.exportBtnHandler = null;
  }

  private onSelectCall(call: Call): void {
    this.state.selectedCall = call;
    this.state.selectedMessage = null;

    // Update ladder header
    const info = this.root.querySelector('#ladderCallInfo') as HTMLElement;
    const from = call.callingNumber ?? 'Unknown';
    const to = call.calledNumber ?? 'Unknown';
    info.innerHTML = `<strong>CID:${call.cid}</strong> &mdash; ${escapeHtml(from)} &rarr; ${escapeHtml(to)} &mdash; ${call.legs.length} leg(s)`;

    // Show export button
    const exportBtn = this.root.querySelector('#exportBtn') as HTMLElement;
    exportBtn.style.display = '';

    // Render findings panel between header and ladder container
    const existing = this.root.querySelector('.findings-panel');
    if (existing) existing.remove();

    if (call.findings.length > 0) {
      const panel = document.createElement('div');
      panel.className = 'findings-panel';
      const count = call.findings.length;
      const worst = call.findings.reduce((s, f) =>
        severityRank(f.severity) > severityRank(s) ? f.severity : s,
        call.findings[0].severity
      );
      panel.innerHTML = `
        <div class="findings-header findings-header-${worst}">
          <span class="findings-toggle">&#9660;</span>
          <span>${count} finding${count !== 1 ? 's' : ''}</span>
        </div>
        <div class="findings-list">
          ${call.findings.map(f => `
            <div class="finding-item finding-${f.severity}">
              <span class="finding-severity">${f.severity}</span>
              <div class="finding-content">
                <div class="finding-title">${escapeHtml(f.title)}</div>
                <div class="finding-description">${escapeHtml(f.description)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      // Toggle collapse
      const header = panel.querySelector('.findings-header') as HTMLElement;
      const list = panel.querySelector('.findings-list') as HTMLElement;
      const toggle = panel.querySelector('.findings-toggle') as HTMLElement;
      header.addEventListener('click', () => {
        const collapsed = list.style.display === 'none';
        list.style.display = collapsed ? '' : 'none';
        toggle.innerHTML = collapsed ? '&#9660;' : '&#9654;';
      });

      const ladderContainer = this.root.querySelector('#ladderContainer') as HTMLElement;
      ladderContainer.parentElement!.insertBefore(panel, ladderContainer);
    }

    // Render ladder
    this.ladder.renderCall(call);

    // Hide detail panel
    this.messageDetail.showEmpty();
  }

  private onSelectMessage(msg: SipMessage): void {
    this.state.selectedMessage = msg;
    this.messageDetail.showMessage(msg);
    this.messageDetail.attachCopyHandler();
    this.ladder.selectMessage(msg.id);
  }

  private async doExport(call: Call, format: string): Promise<void> {
    const svgSource = this.ladder.getSvgSource();

    switch (format) {
      case 'svg':
        exportSvg(svgSource, `call-${call.cid}`);
        break;
      case 'png':
        await exportPng(svgSource, `call-${call.cid}`);
        break;
      case 'json':
        exportJson(call, `call-${call.cid}`);
        break;
      case 'markdown':
        exportMarkdown(call, `call-${call.cid}`);
        break;
      case 'html':
        exportHtmlReport(call, svgSource, `call-${call.cid}`);
        break;
    }
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function severityRank(s: string): number {
  switch (s) {
    case 'critical': return 3;
    case 'error': return 2;
    case 'warning': return 1;
    default: return 0;
  }
}
