/**
 * SVG call ladder renderer.
 *
 * Renders an interactive call flow diagram with:
 * - Vertical lifelines for each participant
 * - Horizontal arrows for SIP messages
 * - Color coding by message type
 * - Click to select message
 */

import type { Call, SipMessage } from '../model/types.js';
import { getParticipants, buildLadderEvents, type LadderEvent } from '../analysis/call.js';
import { formatRelativeTime } from '../parser/timestamp.js';

export interface LadderOptions {
  container: HTMLElement;
  onSelectMessage: (message: SipMessage) => void;
}

// Layout constants
const HEADER_HEIGHT = 60;
const ROW_HEIGHT = 32;
const COL_WIDTH = 280;
const LEFT_MARGIN = 100;  // Space for timestamps
const RIGHT_MARGIN = 40;
const TOP_MARGIN = 20;

export class Ladder {
  private container: HTMLElement;
  private onSelectMessage: (message: SipMessage) => void;
  private selectedMessageId: string | null = null;
  private currentCall: Call | null = null;
  private events: LadderEvent[] = [];

  constructor(opts: LadderOptions) {
    this.container = opts.container;
    this.onSelectMessage = opts.onSelectMessage;
    this.showEmpty();
  }

  showEmpty(): void {
    this.container.innerHTML = '<div class="ladder-empty">Select a call to view its ladder diagram</div>';
  }

  renderCall(call: Call): void {
    this.currentCall = call;
    this.events = buildLadderEvents(call);
    this.selectedMessageId = null;
    this.draw();
  }

  selectMessage(messageId: string): void {
    this.selectedMessageId = messageId;
    // Update selection highlighting
    const svg = this.container.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.arrow-row').forEach(row => {
      row.classList.toggle('selected', row.getAttribute('data-msg-id') === messageId);
    });
  }

  private draw(): void {
    if (!this.currentCall || this.events.length === 0) {
      this.showEmpty();
      return;
    }

    const participants = getParticipants(this.currentCall);
    const numCols = participants.length;
    const numRows = this.events.length;

    const svgWidth = LEFT_MARGIN + numCols * COL_WIDTH + RIGHT_MARGIN;
    const svgHeight = TOP_MARGIN + HEADER_HEIGHT + numRows * ROW_HEIGHT + 40;

    const ns = 'http://www.w3.org/2000/svg';

    // Build SVG string for performance
    let svg = `<svg class="ladder-svg" width="${svgWidth}" height="${svgHeight}" xmlns="${ns}">`;

    // Defs — arrowheads
    svg += `<defs>
      <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="currentColor"/>
      </marker>
      <marker id="arrowhead-green" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="var(--success)"/>
      </marker>
      <marker id="arrowhead-yellow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="var(--warning)"/>
      </marker>
      <marker id="arrowhead-red" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="var(--error)"/>
      </marker>
      <marker id="arrowhead-blue" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="var(--accent)"/>
      </marker>
      <marker id="arrowhead-purple" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="var(--purple)"/>
      </marker>
    </defs>`;

    // Participant headers
    for (let i = 0; i < participants.length; i++) {
      const x = LEFT_MARGIN + i * COL_WIDTH + COL_WIDTH / 2;
      const p = participants[i];
      svg += `<text x="${x}" y="${TOP_MARGIN + 20}" text-anchor="middle" class="participant-label">${escSvg(p.label)}</text>`;
      if (p.addr) {
        svg += `<text x="${x}" y="${TOP_MARGIN + 34}" text-anchor="middle" class="participant-addr">${escSvg(p.addr)}</text>`;
      }
    }

    // Lifelines
    const lifelineTop = TOP_MARGIN + HEADER_HEIGHT - 10;
    const lifelineBottom = TOP_MARGIN + HEADER_HEIGHT + numRows * ROW_HEIGHT + 20;
    for (let i = 0; i < participants.length; i++) {
      const x = LEFT_MARGIN + i * COL_WIDTH + COL_WIDTH / 2;
      svg += `<line x1="${x}" y1="${lifelineTop}" x2="${x}" y2="${lifelineBottom}" class="lifeline"/>`;
    }

    // Message arrows
    for (let row = 0; row < this.events.length; row++) {
      const ev = this.events[row];
      const y = TOP_MARGIN + HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x1 = LEFT_MARGIN + ev.fromCol * COL_WIDTH + COL_WIDTH / 2;
      const x2 = LEFT_MARGIN + ev.toCol * COL_WIDTH + COL_WIDTH / 2;
      const isSelected = ev.message.id === this.selectedMessageId;

      // Arrow class and marker based on message type
      let arrowClass = 'arrow-line arrow-line-request';
      let markerId = 'arrowhead-blue';
      if (ev.message.type === 'response' && ev.message.statusCode) {
        const code = ev.message.statusCode;
        if (code < 200) {
          arrowClass = 'arrow-line arrow-line-1xx';
          markerId = 'arrowhead-yellow';
        } else if (code < 300) {
          arrowClass = 'arrow-line arrow-line-2xx';
          markerId = 'arrowhead-green';
        } else if (code < 400) {
          arrowClass = 'arrow-line arrow-line-3xx';
          markerId = 'arrowhead-purple';
        } else {
          arrowClass = 'arrow-line arrow-line-4xx';
          markerId = 'arrowhead-red';
        }
      }

      // Row group
      svg += `<g class="arrow-row${isSelected ? ' selected' : ''}" data-msg-id="${ev.message.id}" data-row="${row}">`;

      // Selection background
      svg += `<rect class="arrow-bg" x="0" y="${y - ROW_HEIGHT / 2}" width="${svgWidth}" height="${ROW_HEIGHT}" fill="transparent"/>`;

      // Relative time label (left side)
      svg += `<text x="${LEFT_MARGIN - 8}" y="${y + 4}" text-anchor="end" class="arrow-time">${formatRelativeTime(ev.relativeTime)}</text>`;

      // Arrow line
      svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="${arrowClass}" style="marker-end: url(#${markerId})"/>`;

      // Label (above arrow, centered)
      const labelX = (x1 + x2) / 2;
      svg += `<text x="${labelX}" y="${y - 6}" text-anchor="middle" class="arrow-label">${escSvg(ev.label)}</text>`;

      svg += '</g>';
    }

    svg += '</svg>';

    this.container.innerHTML = svg;

    // Add click handlers
    this.container.querySelectorAll('.arrow-row').forEach(row => {
      row.addEventListener('click', () => {
        const msgId = row.getAttribute('data-msg-id');
        if (!msgId) return;
        const ev = this.events.find(e => e.message.id === msgId);
        if (ev) {
          this.selectedMessageId = msgId;
          this.container.querySelectorAll('.arrow-row').forEach(r =>
            r.classList.toggle('selected', r.getAttribute('data-msg-id') === msgId)
          );
          this.onSelectMessage(ev.message);
        }
      });
    });
  }

  /** Get the current SVG element for export */
  getSvgElement(): SVGSVGElement | null {
    return this.container.querySelector('svg');
  }

  /** Get SVG source string for export */
  getSvgSource(): string {
    const svg = this.container.querySelector('svg');
    if (!svg) return '';
    // Clone and inline styles for standalone export
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Add inline style definitions from CSS custom properties
    const style = document.createElement('style');
    style.textContent = `
      .participant-label { font: 600 12px -apple-system, sans-serif; fill: #e0e2e8; }
      .participant-addr { font: 10px -apple-system, sans-serif; fill: #5c5f6a; }
      .lifeline { stroke: #2a2d36; stroke-width: 1; stroke-dasharray: 4 4; }
      .arrow-line-request { stroke: #4f8ff7; }
      .arrow-line-1xx { stroke: #f5a623; stroke-dasharray: 6 3; }
      .arrow-line-2xx { stroke: #34c759; }
      .arrow-line-3xx { stroke: #a78bfa; stroke-dasharray: 6 3; }
      .arrow-line-4xx, .arrow-line-5xx, .arrow-line-6xx { stroke: #ff4757; }
      .arrow-label { font: 500 11px -apple-system, sans-serif; fill: #e0e2e8; }
      .arrow-time { font: 9px 'SF Mono', monospace; fill: #5c5f6a; }
      .arrow-row.selected rect.arrow-bg { fill: rgba(79, 143, 247, 0.08); }
    `;
    clone.insertBefore(style, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }
}

function escSvg(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
