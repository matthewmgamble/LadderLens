/**
 * SIP message boundary detection and extraction from Ribbon SBC log streams.
 *
 * SIP messages appear inline in the log after a decoded-message indicator.
 * They're delimited by log line markers [timestamp] on either end.
 *
 * Key patterns:
 * - v11: After "decoded N:" log line, next non-log-line block is SIP
 * - v13: MSGID headers precede SIP content, may be multi-part
 * - SMM copies: [Before SMM] and "SMM Rules Modified Msg" markers
 * - Wire copy: appears after TransportLayer sending/receiving lines with MSGID
 *
 * The extractor processes lines sequentially, maintaining state to:
 * 1. Detect SIP message boundaries
 * 2. Associate transport context (direction, addresses, GCID)
 * 3. Associate session context (CID, SG, InviteServer/Client)
 * 4. Classify SMM copies (before/after/wire)
 * 5. Reassemble multi-part v13 messages
 */

import {
  parseLogLine,
  isLogLine,
  isMsgIdLine,
  parseMsgIdLine,
  extractSessionContext,
  extractTransportContext,
  extractGcid,
  type SessionContext,
  type TransportContext,
} from './log-line.js';
import { MultipartAssembler, type MsgIdPart } from './multipart.js';
import { parseSipMessage, getCallId, getCSeq, getFromTag, getToTag } from './sip-parser.js';
import type { SipMessage, SmmCopyType, LogLine } from '../model/types.js';

/** SIP request methods we look for at the start of a message */
const SIP_REQUEST_RE = /^(INVITE|ACK|BYE|CANCEL|OPTIONS|REGISTER|REFER|NOTIFY|SUBSCRIBE|PRACK|UPDATE|INFO|MESSAGE|PUBLISH)\s+sip:/;
const SIP_RESPONSE_RE = /^SIP\/2\.0\s+\d{3}\s+/;

function isSipMessageStart(line: string): boolean {
  return SIP_REQUEST_RE.test(line) || SIP_RESPONSE_RE.test(line);
}

export interface ExtractedSipMessage {
  raw: string;
  startLine: number;
  endLine: number;
  timestamp: number;
  timestampRaw: string;
  smmType: SmmCopyType;
  direction: 'sent' | 'received';
  transport?: TransportContext;
  sessionContext?: SessionContext;
  cid?: number;
  gcid?: number;
  msgId?: number;
}

interface ExtractorState {
  /** Currently accumulating SIP message lines */
  sipLines: string[];
  /** Whether we're inside a SIP message block */
  inSipMessage: boolean;
  /** Start line number of current SIP message */
  sipStartLine: number;
  /** Current SMM classification */
  currentSmmType: SmmCopyType;
  /** Current transport context */
  currentTransport: TransportContext | null;
  /** Most recent session context seen */
  lastSessionContext: SessionContext | null;
  /** Most recent CID seen in any context */
  lastCid: number | undefined;
  /** Most recent GCID seen */
  lastGcid: number | undefined;
  /** Current timestamp */
  currentTimestamp: number;
  currentTimestampRaw: string;
  /** Whether the previous log line indicated [Before SMM] */
  expectBeforeSmm: boolean;
  /** Whether the previous log line indicated SMM Rules Modified */
  expectSmmModified: boolean;
  /** Whether the previous log line was a transport sending line */
  expectWireCopy: boolean;
  /** Current direction from context */
  currentDirection: 'sent' | 'received';
  /** Current MSGID info */
  currentMsgId: number | undefined;
}

export class SipExtractor {
  private state: ExtractorState;
  private assembler = new MultipartAssembler();
  private messages: ExtractedSipMessage[] = [];
  private messageIdCounter = 0;

  constructor() {
    this.state = this.initialState();
  }

  private initialState(): ExtractorState {
    return {
      sipLines: [],
      inSipMessage: false,
      sipStartLine: 0,
      currentSmmType: 'wire',
      currentTransport: null,
      lastSessionContext: null,
      lastCid: undefined,
      lastGcid: undefined,
      currentTimestamp: 0,
      currentTimestampRaw: '',
      expectBeforeSmm: false,
      expectSmmModified: false,
      expectWireCopy: false,
      currentDirection: 'received',
      currentMsgId: undefined,
    };
  }

  /**
   * Process a single line from the log file.
   * Call this for each line in order.
   */
  processLine(line: string, lineNumber: number): void {
    const s = this.state;

    // Check if this is a structured log line
    if (isLogLine(line)) {
      // If we were accumulating a SIP message, flush it
      if (s.inSipMessage) {
        this.flushSipMessage(lineNumber - 1);
      }

      const logLine = parseLogLine(line, lineNumber);
      if (!logLine) return;

      s.currentTimestamp = logLine.timestamp;
      s.currentTimestampRaw = logLine.timestampRaw;

      // Check for session context
      const sessCtx = extractSessionContext(logLine.message);
      if (sessCtx) {
        s.lastSessionContext = sessCtx;
        if (sessCtx.cid !== undefined) {
          s.lastCid = sessCtx.cid;
        }
      }

      // Check for CID in ccc messages: [CID:5105]
      const cidMatch = /\[CID:(\d+)\]/.exec(logLine.message);
      if (cidMatch) {
        s.lastCid = parseInt(cidMatch[1]);
      }

      // Check for decoded message indicator (incoming message)
      // v11: "origLen:893 decodedLength:893 decoded"
      // v13: "originalLen:2180 decodedLength:2180 decoded"
      if (logLine.message.includes('decodedLength:') && logLine.message.includes('decoded')) {
        s.currentDirection = 'received';
        s.expectWireCopy = true;
        s.expectBeforeSmm = false;
        s.expectSmmModified = false;
      }

      // Check for transport context
      const transportCtx = extractTransportContext(logLine.message);
      if (transportCtx) {
        s.currentTransport = transportCtx;
        s.currentDirection = transportCtx.direction;
        if (transportCtx.gcid !== undefined) {
          s.lastGcid = transportCtx.gcid;
          if (s.lastCid === undefined) {
            s.lastCid = transportCtx.gcid;
          }
        }
        s.expectWireCopy = true;
        s.expectBeforeSmm = false;
        s.expectSmmModified = false;
      }

      // "tlDataReceived" also indicates incoming direction
      if (logLine.message.includes('tlDataReceived:Received message')) {
        s.currentDirection = 'received';
      }

      // Check for SMM markers
      if (logLine.message.includes('SMM Rules Original Msg') || logLine.message.includes('[Before SMM]')) {
        s.expectBeforeSmm = true;
        s.expectSmmModified = false;
        s.expectWireCopy = false;
      }
      if (logLine.message.includes('SMM Rules Modified Msg')) {
        s.expectSmmModified = true;
        s.expectBeforeSmm = false;
        s.expectWireCopy = false;
      }

      // Check for GCID in any message
      const gcid = extractGcid(logLine.message);
      if (gcid !== null) {
        s.lastGcid = gcid;
      }

      return;
    }

    // Check for [Before SMM] marker on a standalone line
    if (line.trim() === '[Before SMM]') {
      s.expectBeforeSmm = true;
      s.expectSmmModified = false;
      s.expectWireCopy = false;
      return;
    }

    // Check for MSGID line
    if (isMsgIdLine(line)) {
      if (s.inSipMessage) {
        this.flushSipMessage(lineNumber - 1);
      }
      const info = parseMsgIdLine(line);
      if (info) {
        s.currentMsgId = info.msgId;
        // MSGID after a transport sending line = wire copy
        // We'll determine SMM type based on state flags
        if (s.expectWireCopy) {
          s.currentSmmType = 'wire';
        } else if (s.expectBeforeSmm) {
          s.currentSmmType = 'before-smm';
        } else if (s.expectSmmModified) {
          s.currentSmmType = 'smm-modified';
        } else {
          // Default: messages received from network are wire copies
          s.currentSmmType = 'wire';
        }
      }
      return;
    }

    // If we see the start of a SIP message
    if (!s.inSipMessage && isSipMessageStart(line)) {
      s.inSipMessage = true;
      s.sipStartLine = lineNumber;
      s.sipLines = [line];

      // Determine SMM type for non-MSGID messages (v11 or inline)
      if (s.expectBeforeSmm) {
        s.currentSmmType = 'before-smm';
      } else if (s.expectSmmModified) {
        s.currentSmmType = 'smm-modified';
      } else if (s.expectWireCopy) {
        s.currentSmmType = 'wire';
      } else {
        s.currentSmmType = 'wire';
      }
      return;
    }

    // If we're inside a SIP message, accumulate the line
    if (s.inSipMessage) {
      s.sipLines.push(line);
      return;
    }

    // Blank lines or other non-log content — could be leading into a SIP message
    // (some messages have a blank line after the MSGID/log-line before the SIP content)
  }

  /**
   * Flush the currently accumulated SIP message.
   */
  private flushSipMessage(endLine: number): void {
    const s = this.state;
    if (!s.inSipMessage || s.sipLines.length === 0) {
      s.inSipMessage = false;
      return;
    }

    const raw = s.sipLines.join('\n');
    s.inSipMessage = false;
    s.sipLines = [];

    // Use direction from context
    const direction = s.currentDirection;

    this.messages.push({
      raw,
      startLine: s.sipStartLine,
      endLine,
      timestamp: s.currentTimestamp,
      timestampRaw: s.currentTimestampRaw,
      smmType: s.currentSmmType,
      direction,
      transport: s.currentTransport ?? undefined,
      sessionContext: s.lastSessionContext ?? undefined,
      cid: s.lastCid,
      gcid: s.lastGcid,
      msgId: s.currentMsgId,
    });

    // Reset per-message state
    s.expectBeforeSmm = false;
    s.expectSmmModified = false;
    s.expectWireCopy = false;
    s.currentDirection = 'received';
    s.currentTransport = null;
    s.currentMsgId = undefined;
  }

  /**
   * Call after processing all lines to flush any remaining SIP message.
   */
  finish(lastLineNumber: number): void {
    if (this.state.inSipMessage) {
      this.flushSipMessage(lastLineNumber);
    }
  }

  /**
   * Get all extracted SIP messages.
   */
  getMessages(): ExtractedSipMessage[] {
    return this.messages;
  }

  /**
   * Parse all extracted messages into full SipMessage objects.
   */
  buildSipMessages(): SipMessage[] {
    const result: SipMessage[] = [];

    for (const ext of this.messages) {
      const parsed = parseSipMessage(ext.raw);
      if (!parsed) continue;

      const callId = getCallId(parsed.headers);
      const cseq = getCSeq(parsed.headers);
      const fromTag = getFromTag(parsed.headers);
      const toTag = getToTag(parsed.headers);

      const msg: SipMessage = {
        id: `msg-${++this.messageIdCounter}`,
        type: parsed.type,
        method: parsed.method,
        statusCode: parsed.statusCode,
        reasonPhrase: parsed.reasonPhrase,
        requestUri: parsed.requestUri,
        headers: parsed.headers,
        rawHeaders: parsed.rawHeaders,
        sdp: parsed.sdp,
        rawBody: parsed.rawBody,
        rawText: ext.raw,
        timestamp: ext.timestamp,
        timestampRaw: ext.timestampRaw,
        startLine: ext.startLine,
        endLine: ext.endLine,
        smmType: ext.smmType,
        direction: ext.direction,
        transport: ext.transport ? {
          localAddr: ext.transport.localAddr,
          localPort: ext.transport.localPort,
          remoteAddr: ext.transport.remoteAddr,
          remotePort: ext.transport.remotePort,
          protocol: ext.transport.protocol ?? 'UDP',
        } : undefined,
        cid: ext.cid ?? ext.gcid,
        gcid: ext.gcid,
        sessionType: ext.sessionContext?.sessionType as SipMessage['sessionType'],
        signalingGroup: ext.sessionContext?.signalingGroup,
        sessionId: ext.sessionContext?.sessionId,
        msgIdInfo: ext.msgId !== undefined ? {
          msgId: ext.msgId,
          size: 0,
          partNum: 1,
          totalParts: 1,
        } : undefined,
      };

      result.push(msg);
    }

    return result;
  }
}

/**
 * Process an array of lines and extract all SIP messages.
 * Convenience function for testing and simple use cases.
 */
export function extractSipMessages(lines: string[]): SipMessage[] {
  const extractor = new SipExtractor();
  for (let i = 0; i < lines.length; i++) {
    extractor.processLine(lines[i], i + 1);
  }
  extractor.finish(lines.length);
  return extractor.buildSipMessages();
}
