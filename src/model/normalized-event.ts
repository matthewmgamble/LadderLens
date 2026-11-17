/**
 * Normalized event schema for versioned output.
 *
 * This provides a stable serialization format for parsed events,
 * independent of internal types, suitable for JSON export and
 * external tool consumption.
 */

export interface NormalizedEvent {
  /** Schema version */
  version: 1;
  /** Event type */
  type: 'sip-message' | 'log-entry' | 'call-state-change';
  /** Epoch milliseconds */
  timestamp: number;
  /** Original line number(s) */
  lines: [number, number];
  /** Event-specific payload */
  payload: SipMessageEvent | LogEntryEvent | CallStateEvent;
}

export interface SipMessageEvent {
  kind: 'sip-message';
  method?: string;
  statusCode?: number;
  callId: string;
  cseq: string;
  direction: 'sent' | 'received';
  smmType: 'before-smm' | 'smm-modified' | 'wire';
  cid?: number;
  signalingGroup?: number;
  rawText: string;
}

export interface LogEntryEvent {
  kind: 'log-entry';
  component: string;
  level: string;
  source: string;
  message: string;
}

export interface CallStateEvent {
  kind: 'call-state-change';
  cid: number;
  fromState: string;
  toState: string;
  sessionType: string;
}
