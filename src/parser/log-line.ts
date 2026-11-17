/**
 * Log line tokenizer for Ribbon SBC WebUI diagnostic exports.
 *
 * Handles two distinct formats:
 *
 * v11 (SBC SWe 11.x):
 *   [2022-12-05 18:34:37,978] 7900 006a com.sonus.sbc.sip DEBUG (sipSignalingGroupConfig.cpp:1170) - "message"
 *
 * v13 (SBC SWe 13.x):
 *   [2026-11-17T14:00:24Z,073] 515 000f com.sonus.sbc.sip <PID 4879> INFO (CallSession.cpp:9783) - message
 */

import { parseTimestamp } from './timestamp.js';
import type { LogLine, LogVersion } from '../model/types.js';

/**
 * v11 pattern:
 * [timestamp] sequence hex component LEVEL (source:line) - message
 */
const V11_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\]\s+(\d+) ([0-9a-f]+) (\S+) (\w+) \(([^)]+)\) - (.*)$/;

/**
 * v13 pattern:
 * [timestamp] sequence hex component <PID N> LEVEL (source:line) - message
 *
 * Note: some v13 lines use com.sonus.log.sbc instead of com.sonus.sbc.sip, and
 * some omit the <PID N> segment. We handle both.
 */
const V13_WITH_PID_RE = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z,\d{3})\]\s+(\d+) ([0-9a-f]+) (\S+) <PID (\d+)> (\w+) \(([^)]+)\) - (.*)$/;
const V13_NO_PID_RE = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z,\d{3})\]\s+(\d+) ([0-9a-f]+) (\S+) (\w+) \(([^)]+)\) - (.*)$/;

/**
 * Detect whether a line starts with a v11 or v13 timestamp bracket.
 * Used to identify log line boundaries (vs SIP message content).
 */
export function isLogLine(line: string): boolean {
  return line.startsWith('[') && (
    /^\[\d{4}-\d{2}-\d{2} /.test(line) ||
    /^\[\d{4}-\d{2}-\d{2}T/.test(line)
  );
}

/**
 * Quick check if a line starts with a MSGID marker (v13 chunked SIP).
 */
export function isMsgIdLine(line: string): boolean {
  return line.startsWith('MSGID:');
}

/** MSGID pattern: MSGID:426897 SIZE:820 PART:001-003 */
const MSGID_RE = /^MSGID:(\d+) SIZE:(\d+) PART:(\d+)-(\d+)$/;

export function parseMsgIdLine(line: string): { msgId: number; size: number; partNum: number; totalParts: number } | null {
  const m = MSGID_RE.exec(line);
  if (!m) return null;
  return {
    msgId: parseInt(m[1]),
    size: parseInt(m[2]),
    partNum: parseInt(m[3]),
    totalParts: parseInt(m[4]),
  };
}

/**
 * Detect format version from a line.
 */
export function detectVersion(line: string): LogVersion | null {
  if (V13_WITH_PID_RE.test(line) || V13_NO_PID_RE.test(line)) return 'v13';
  if (V11_RE.test(line)) return 'v11';
  return null;
}

/**
 * Parse a single structured log line. Returns null for non-log-line content
 * (SIP message bodies, blank lines, MSGID headers, etc.).
 */
export function parseLogLine(line: string, lineNumber: number): LogLine | null {
  // Try v13 with PID first (most specific)
  let m = V13_WITH_PID_RE.exec(line);
  if (m) {
    const tsRaw = `[${m[1]}]`;
    const ts = parseTimestamp(tsRaw);
    if (!ts) return null;
    return {
      lineNumber,
      timestamp: ts.epochMs,
      timestampRaw: tsRaw,
      sequence: parseInt(m[2]),
      hexCounter: m[3],
      component: m[4],
      pid: parseInt(m[5]),
      level: m[6],
      source: m[7],
      message: m[8],
      version: 'v13',
    };
  }

  // Try v13 without PID
  m = V13_NO_PID_RE.exec(line);
  if (m && /^\d{4}-\d{2}-\d{2}T/.test(m[1])) {
    const tsRaw = `[${m[1]}]`;
    const ts = parseTimestamp(tsRaw);
    if (!ts) return null;
    return {
      lineNumber,
      timestamp: ts.epochMs,
      timestampRaw: tsRaw,
      sequence: parseInt(m[2]),
      hexCounter: m[3],
      component: m[4],
      level: m[5],
      source: m[6],
      message: m[7],
      version: 'v13',
    };
  }

  // Try v11
  m = V11_RE.exec(line);
  if (m) {
    const tsRaw = `[${m[1]}]`;
    const ts = parseTimestamp(tsRaw);
    if (!ts) return null;
    return {
      lineNumber,
      timestamp: ts.epochMs,
      timestampRaw: tsRaw,
      sequence: parseInt(m[2]),
      hexCounter: m[3],
      component: m[4],
      level: m[5],
      source: m[6],
      message: m[7],
      version: 'v11',
    };
  }

  return null;
}

/**
 * Extract session context from a CallSession log message.
 * Pattern: {InviteServer SG(4):3296d 0x1afb000 Proceeding (nil) [1:0:0:0][CID:118]}
 * or:      {InviteClient SG(4):1787a1 0x1cef400 NwkConnecting 0x11612a50 [1:0:4:18][CID:5105]}
 */
const SESSION_CONTEXT_RE = /\{(InviteServer|InviteClient|OptionsClient|OptionsServerSession) SG\((\d+)\):([0-9a-f]+) /;
const CID_RE = /\[CID:(\d+)\]/;

export interface SessionContext {
  sessionType: 'InviteServer' | 'InviteClient' | 'OptionsClient' | 'OptionsServerSession';
  signalingGroup: number;
  sessionId: string;
  cid?: number;
}

export function extractSessionContext(message: string): SessionContext | null {
  const m = SESSION_CONTEXT_RE.exec(message);
  if (!m) return null;

  const cidMatch = CID_RE.exec(message);
  return {
    sessionType: m[1] as SessionContext['sessionType'],
    signalingGroup: parseInt(m[2]),
    sessionId: m[3],
    cid: cidMatch ? parseInt(cidMatch[1]) : undefined,
  };
}

/**
 * Extract GCID from transport log lines.
 * Pattern: GCID=5105
 */
const GCID_RE = /GCID=(\d+)/;

export function extractGcid(message: string): number | null {
  const m = GCID_RE.exec(message);
  return m ? parseInt(m[1]) : null;
}

/**
 * Extract transport info from TransportLayer sending/receiving lines.
 * Sending: "sending from [10.21.205.68]:27396 to [67.22.121.140]:5061 GCID=5105"
 * Receiving: "DataReadCB:Incoming message on [10.21.205.68]:5061 from [52.114.148.0]"
 */
const SENDING_RE = /sending from \[([^\]]+)\]:(\d+) to \[([^\]]+)\]:(\d+)/;
const RECEIVING_RE = /message on \[([^\]]+)\]:(\d+) from \[([^\]]+)\]/;

export interface TransportContext {
  localAddr: string;
  localPort: number;
  remoteAddr: string;
  remotePort: number;
  direction: 'sent' | 'received';
  gcid?: number;
  protocol?: string;
}

export function extractTransportContext(message: string): TransportContext | null {
  let m = SENDING_RE.exec(message);
  if (m) {
    const gcid = extractGcid(message);
    // Extract protocol from "over 00TLS..." or "over 00TCP..."
    const protoMatch = /over 00(TLS|TCP|UDP)/.exec(message);
    return {
      localAddr: m[1],
      localPort: parseInt(m[2]),
      remoteAddr: m[3],
      remotePort: parseInt(m[4]),
      direction: 'sent',
      gcid: gcid ?? undefined,
      protocol: protoMatch ? protoMatch[1] : undefined,
    };
  }

  m = RECEIVING_RE.exec(message);
  if (m) {
    // For incoming: local is where we received, remote is the sender
    // Pattern: "on [local]:port from [remote]"
    // The remote port sometimes appears after "CRLF is truncated:" oddly
    const afterFrom = message.substring(message.indexOf('from ['));
    const portMatch = /from \[([^\]]+)\].*?:(\d+)/.exec(afterFrom);
    return {
      localAddr: m[1],
      localPort: parseInt(m[2]),
      remoteAddr: m[3],
      remotePort: portMatch ? parseInt(portMatch[2]) : 0,
      direction: 'received',
    };
  }

  return null;
}
