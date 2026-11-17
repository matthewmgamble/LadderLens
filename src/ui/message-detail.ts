/**
 * SIP message inspector panel.
 *
 * Shows full message details when a ladder arrow is clicked:
 * - Summary (method/status, Call-ID, CSeq, direction)
 * - Headers
 * - SDP codec table
 * - Raw message text
 * - Copy to clipboard
 */

import type { SipMessage } from '../model/types.js';
import { formatTime } from '../parser/timestamp.js';
import { getCSeq, getCallId } from '../parser/sip-parser.js';

export interface MessageDetailOptions {
  container: HTMLElement;
  onClose: () => void;
}

export class MessageDetail {
  private container: HTMLElement;
  private onClose: () => void;
  private currentMessage: SipMessage | null = null;
  private activeTab: 'headers' | 'sdp' | 'raw' = 'headers';

  constructor(opts: MessageDetailOptions) {
    this.container = opts.container;
    this.onClose = opts.onClose;
    this.showEmpty();
  }

  showEmpty(): void {
    this.container.style.display = 'none';
  }

  showMessage(msg: SipMessage): void {
    this.currentMessage = msg;
    this.container.style.display = '';
    this.activeTab = 'headers';
    this.render();
  }

  private render(): void {
    const msg = this.currentMessage;
    if (!msg) return;

    const title = msg.type === 'request'
      ? `${msg.method} ${msg.requestUri ?? ''}`
      : `${msg.statusCode} ${msg.reasonPhrase ?? ''}`;

    const cseq = getCSeq(msg.headers);
    const callId = getCallId(msg.headers);

    this.container.innerHTML = `
      <div class="detail-header">
        <span class="detail-title">${escapeHtml(title)}</span>
        <button class="detail-close" id="detailClose">&times;</button>
      </div>
      <div class="detail-tabs">
        <button class="detail-tab ${this.activeTab === 'headers' ? 'active' : ''}" data-tab="headers">Headers</button>
        ${msg.sdp ? `<button class="detail-tab ${this.activeTab === 'sdp' ? 'active' : ''}" data-tab="sdp">SDP</button>` : ''}
        <button class="detail-tab ${this.activeTab === 'raw' ? 'active' : ''}" data-tab="raw">Raw</button>
      </div>
      <div class="detail-content" id="detailContent"></div>
    `;

    // Tab handlers
    this.container.querySelectorAll('.detail-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.getAttribute('data-tab') as typeof this.activeTab;
        this.render();
      });
    });

    // Close handler
    this.container.querySelector('#detailClose')!.addEventListener('click', () => {
      this.showEmpty();
      this.onClose();
    });

    // Render tab content
    const content = this.container.querySelector('#detailContent')!;

    if (this.activeTab === 'headers') {
      content.innerHTML = this.renderHeaders(msg);
    } else if (this.activeTab === 'sdp' && msg.sdp) {
      content.innerHTML = this.renderSdp(msg);
    } else if (this.activeTab === 'raw') {
      content.innerHTML = this.renderRaw(msg);
    }
  }

  private renderHeaders(msg: SipMessage): string {
    const cseq = getCSeq(msg.headers);
    const callId = getCallId(msg.headers);

    let html = `<div class="detail-section">
      <div class="detail-section-title">Message Info</div>
      <dl class="detail-kv">
        <dt>Direction</dt><dd>${msg.direction}</dd>
        <dt>SMM Type</dt><dd>${msg.smmType}</dd>
        <dt>Timestamp</dt><dd>${formatTime(msg.timestamp)}</dd>
        <dt>CID</dt><dd>${msg.cid ?? 'N/A'}</dd>
        ${callId ? `<dt>Call-ID</dt><dd>${escapeHtml(callId)}</dd>` : ''}
        ${cseq ? `<dt>CSeq</dt><dd>${cseq.seq} ${cseq.method}</dd>` : ''}
        ${msg.signalingGroup !== undefined ? `<dt>SG</dt><dd>SG(${msg.signalingGroup})</dd>` : ''}
        ${msg.transport ? `
          <dt>Local</dt><dd>${msg.transport.localAddr}:${msg.transport.localPort}</dd>
          <dt>Remote</dt><dd>${msg.transport.remoteAddr}:${msg.transport.remotePort}</dd>
          <dt>Protocol</dt><dd>${msg.transport.protocol}</dd>
        ` : ''}
        <dt>Lines</dt><dd>${msg.startLine}–${msg.endLine}</dd>
      </dl>
    </div>`;

    // All headers
    html += `<div class="detail-section">
      <div class="detail-section-title">SIP Headers</div>
      <dl class="detail-kv">`;

    for (const [name, values] of msg.headers) {
      for (const val of values) {
        html += `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(val)}</dd>`;
      }
    }

    html += `</dl></div>`;

    return html;
  }

  private renderSdp(msg: SipMessage): string {
    if (!msg.sdp) return '<p>No SDP body</p>';

    let html = '';

    if (msg.sdp.connectionAddress) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Session</div>
        <dl class="detail-kv">
          <dt>Connection</dt><dd>${escapeHtml(msg.sdp.connectionAddress)}</dd>
        </dl>
      </div>`;
    }

    for (const media of msg.sdp.media) {
      html += `<div class="detail-section">
        <div class="detail-section-title">${escapeHtml(media.type)} Media</div>
        <dl class="detail-kv">
          <dt>Port</dt><dd>${media.port}</dd>
          <dt>Protocol</dt><dd>${escapeHtml(media.protocol)}</dd>
          ${media.connectionAddress ? `<dt>Address</dt><dd>${escapeHtml(media.connectionAddress)}</dd>` : ''}
          ${media.direction ? `<dt>Direction</dt><dd>${media.direction}</dd>` : ''}
          ${media.ptime ? `<dt>Ptime</dt><dd>${media.ptime}ms</dd>` : ''}
        </dl>`;

      if (media.codecs.length > 0) {
        html += `<table class="detail-codec-table">
          <thead><tr><th>PT</th><th>Codec</th><th>Clock</th></tr></thead>
          <tbody>`;
        for (const codec of media.codecs) {
          html += `<tr>
            <td>${codec.payloadType}</td>
            <td>${escapeHtml(codec.name)}</td>
            <td>${codec.clockRate}</td>
          </tr>`;
        }
        html += `</tbody></table>`;
      }

      html += `</div>`;
    }

    return html;
  }

  private renderRaw(msg: SipMessage): string {
    return `
      <div class="detail-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div class="detail-section-title" style="margin-bottom:0">Raw SIP Message</div>
          <button class="copy-btn" id="copyRaw">Copy</button>
        </div>
        <pre class="detail-raw">${escapeHtml(msg.rawText)}</pre>
      </div>
    `;
  }

  /** Post-render: attach copy handler (call after inserting into DOM) */
  attachCopyHandler(): void {
    const btn = this.container.querySelector('#copyRaw');
    if (btn && this.currentMessage) {
      const raw = this.currentMessage.rawText;
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(raw).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
      });
    }
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
