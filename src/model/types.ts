/** Log format version detected from the file */
export type LogVersion = 'v11' | 'v13';

/** Parsed log line from either format */
export interface LogLine {
  /** Line number in original file */
  lineNumber: number;
  /** Normalized epoch milliseconds */
  timestamp: number;
  /** Original timestamp string */
  timestampRaw: string;
  /** Sequence number from log */
  sequence: number;
  /** Hex counter field */
  hexCounter: string;
  /** Component path e.g. com.sonus.sbc.sip */
  component: string;
  /** PID (v13 only) */
  pid?: number;
  /** Log level: DEBUG, INFO, WARN, ERROR */
  level: string;
  /** Source file and line e.g. CallSession.cpp:1379 */
  source: string;
  /** Message body after the " - " separator */
  message: string;
  /** Detected format version */
  version: LogVersion;
}

/** A raw log line that is not a structured log entry (SIP message content, blank lines, etc.) */
export interface ContentLine {
  lineNumber: number;
  text: string;
}

/** MSGID metadata for v13 chunked messages */
export interface MsgIdInfo {
  msgId: number;
  size: number;
  partNum: number;
  totalParts: number;
}

/** SMM copy classification */
export type SmmCopyType = 'before-smm' | 'smm-modified' | 'wire';

/** A SIP message extracted from the log */
export interface SipMessage {
  /** Unique ID for this message within the parse */
  id: string;
  /** Whether this is a request or response */
  type: 'request' | 'response';
  /** SIP method (INVITE, ACK, BYE, etc.) for requests */
  method?: string;
  /** Status code for responses */
  statusCode?: number;
  /** Reason phrase for responses */
  reasonPhrase?: string;
  /** Request URI for requests */
  requestUri?: string;
  /** Parsed headers as a map (header name → values) */
  headers: Map<string, string[]>;
  /** Raw header text */
  rawHeaders: string;
  /** Parsed SDP body, if present */
  sdp?: SdpBody;
  /** Raw body text (SDP or other) */
  rawBody: string;
  /** Full raw SIP message text */
  rawText: string;
  /** Timestamp from surrounding log context */
  timestamp: number;
  /** Original timestamp string */
  timestampRaw: string;
  /** Line number range in original file */
  startLine: number;
  endLine: number;
  /** SMM copy classification */
  smmType: SmmCopyType;
  /** Direction: sent or received */
  direction: 'sent' | 'received';
  /** Transport info from log context */
  transport?: TransportInfo;
  /** CID from surrounding log context */
  cid?: number;
  /** GCID from transport line */
  gcid?: number;
  /** Session type from log context */
  sessionType?: 'InviteServer' | 'InviteClient' | 'OptionsClient' | 'OptionsServerSession' | 'other';
  /** Signaling group number */
  signalingGroup?: number;
  /** Session hex ID */
  sessionId?: string;
  /** MSGID info for v13 */
  msgIdInfo?: MsgIdInfo;
  /** Linked SMM copies (before/after) */
  smmBefore?: SipMessage;
  smmAfter?: SipMessage;
}

/** Transport context from log line preceding a SIP message */
export interface TransportInfo {
  /** Local address */
  localAddr: string;
  /** Local port */
  localPort: number;
  /** Remote address */
  remoteAddr: string;
  /** Remote port */
  remotePort: number;
  /** Protocol (UDP, TCP, TLS) */
  protocol: string;
}

/** Parsed SDP body */
export interface SdpBody {
  /** Session-level connection address */
  connectionAddress?: string;
  /** Media descriptions */
  media: SdpMedia[];
  /** Raw SDP text */
  raw: string;
}

/** SDP media description */
export interface SdpMedia {
  /** Media type (audio, video) */
  type: string;
  /** Port number */
  port: number;
  /** Protocol (RTP/AVP, RTP/SAVP, etc.) */
  protocol: string;
  /** Codec payload types */
  formats: number[];
  /** Connection address (media-level override) */
  connectionAddress?: string;
  /** Codec details from rtpmap */
  codecs: SdpCodec[];
  /** Direction attribute */
  direction?: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive';
  /** Ptime */
  ptime?: number;
}

/** SDP codec from rtpmap */
export interface SdpCodec {
  payloadType: number;
  name: string;
  clockRate: number;
  parameters?: string;
}

/** A call leg (one side of the B2BUA) */
export interface CallLeg {
  /** Leg direction */
  direction: 'ingress' | 'egress';
  /** Signaling group number */
  signalingGroup: number;
  /** Session type */
  sessionType: 'InviteServer' | 'InviteClient';
  /** SIP Call-ID for this leg */
  callId: string;
  /** From tag */
  fromTag?: string;
  /** To tag */
  toTag?: string;
  /** Remote participant address */
  remoteAddr?: string;
  /** Remote participant hostname/label */
  remoteLabel?: string;
  /** Ordered SIP messages on this leg (wire copies) */
  messages: SipMessage[];
}

/** A complete call record */
export interface Call {
  /** Internal Ribbon CID */
  cid: number;
  /** Call legs */
  legs: CallLeg[];
  /** Calling number (from ingress From header) */
  callingNumber?: string;
  /** Called number (from ingress To/Request-URI) */
  calledNumber?: string;
  /** Call start time (first INVITE) */
  startTime: number;
  /** Call end time (last BYE/response or timeout) */
  endTime?: number;
  /** Duration in milliseconds */
  duration?: number;
  /** Call outcome */
  status: 'success' | 'failed' | 'partial' | 'in-progress';
  /** Final response code (from egress leg) */
  finalResponseCode?: number;
  /** Whether this is an OPTIONS session (hidden by default) */
  isOptions: boolean;
  /** All messages across all legs, sorted by timestamp */
  allMessages: SipMessage[];
  /** Troubleshooting findings */
  findings: Finding[];
}

/** A troubleshooting finding */
export interface Finding {
  /** Unique rule ID */
  ruleId: string;
  /** Severity level */
  severity: 'info' | 'warning' | 'error' | 'critical';
  /** Short title */
  title: string;
  /** Detailed description */
  description: string;
  /** References to evidence messages */
  evidence: string[];
  /** Confidence 0-1 */
  confidence: number;
}

/** Complete parse result */
export interface ParseResult {
  /** Detected log version */
  version: LogVersion;
  /** Parsed calls */
  calls: Call[];
  /** Messages that couldn't be correlated to a call */
  unmatchedMessages: SipMessage[];
  /** Parser warnings */
  warnings: string[];
  /** Total lines processed */
  totalLines: number;
  /** Total bytes processed */
  totalBytes: number;
  /** Parse duration in ms */
  parseDurationMs: number;
}
