/**
 * SIP message parser.
 *
 * Parses raw SIP message text into structured objects with:
 * - Request line / status line
 * - Headers (multi-value aware, folded line support)
 * - SDP body parsing (codecs, media, connection info)
 */

import type { SdpBody, SdpMedia, SdpCodec } from '../model/types.js';

export interface ParsedSipMessage {
  type: 'request' | 'response';
  method?: string;
  requestUri?: string;
  statusCode?: number;
  reasonPhrase?: string;
  headers: Map<string, string[]>;
  rawHeaders: string;
  sdp?: SdpBody;
  rawBody: string;
}

const REQUEST_LINE_RE = /^(INVITE|ACK|BYE|CANCEL|OPTIONS|REGISTER|REFER|NOTIFY|SUBSCRIBE|PRACK|UPDATE|INFO|MESSAGE|PUBLISH)\s+(.*?)\s+SIP\/2\.0\s*$/;
const STATUS_LINE_RE = /^SIP\/2\.0\s+(\d{3})\s+(.*?)\s*$/;

/**
 * Parse a raw SIP message string into a structured object.
 */
export function parseSipMessage(raw: string): ParsedSipMessage | null {
  // Trim leading blank lines
  const trimmed = raw.replace(/^\s*\n/, '');
  if (!trimmed) return null;

  const lines = trimmed.split('\n');
  if (lines.length === 0) return null;

  // Parse first line (request or status)
  const firstLine = lines[0].trim();
  let type: 'request' | 'response';
  let method: string | undefined;
  let requestUri: string | undefined;
  let statusCode: number | undefined;
  let reasonPhrase: string | undefined;

  let reqMatch = REQUEST_LINE_RE.exec(firstLine);
  if (reqMatch) {
    type = 'request';
    method = reqMatch[1];
    requestUri = reqMatch[2];
  } else {
    let statusMatch = STATUS_LINE_RE.exec(firstLine);
    if (statusMatch) {
      type = 'response';
      statusCode = parseInt(statusMatch[1]);
      reasonPhrase = statusMatch[2];
    } else {
      return null;
    }
  }

  // Parse headers (until blank line)
  const headers = new Map<string, string[]>();
  const headerLines: string[] = [];
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    // Blank line separates headers from body
    if (line.trim() === '') {
      i++;
      break;
    }

    // Handle folded headers (line starting with whitespace)
    if (/^\s/.test(line) && headerLines.length > 0) {
      headerLines[headerLines.length - 1] += ' ' + line.trim();
      continue;
    }

    headerLines.push(line);
  }

  // Parse each header line
  const rawHeaderText = headerLines.join('\n');
  for (const hl of headerLines) {
    const colonIdx = hl.indexOf(':');
    if (colonIdx < 1) continue;
    const name = hl.substring(0, colonIdx).trim();
    const value = hl.substring(colonIdx + 1).trim();
    const key = name.toLowerCase();
    const existing = headers.get(key);
    if (existing) {
      existing.push(value);
    } else {
      headers.set(key, [value]);
    }
  }

  // Remaining lines are the body
  const bodyLines = lines.slice(i);
  const rawBody = bodyLines.join('\n').trim();

  // Parse SDP if content type indicates it
  let sdp: SdpBody | undefined;
  const contentType = headers.get('content-type')?.[0] ?? '';
  if (contentType.includes('application/sdp') || (!contentType && rawBody.startsWith('v='))) {
    sdp = parseSdp(rawBody);
  }

  return {
    type,
    method,
    requestUri,
    statusCode,
    reasonPhrase,
    headers,
    rawHeaders: rawHeaderText,
    sdp,
    rawBody,
  };
}

/**
 * Parse an SDP body.
 */
export function parseSdp(raw: string): SdpBody {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let connectionAddress: string | undefined;
  const media: SdpMedia[] = [];
  let currentMedia: SdpMedia | null = null;

  for (const line of lines) {
    const type = line[0];
    const value = line.substring(2);

    if (type === 'c') {
      // c=IN IP4 52.115.232.218
      const parts = value.split(/\s+/);
      const addr = parts[2] ?? parts[0];
      if (currentMedia) {
        currentMedia.connectionAddress = addr;
      } else {
        connectionAddress = addr;
      }
    } else if (type === 'm') {
      // m=audio 50332 RTP/SAVP 104 121 9 103
      const parts = value.split(/\s+/);
      currentMedia = {
        type: parts[0],
        port: parseInt(parts[1]),
        protocol: parts[2],
        formats: parts.slice(3).map(Number).filter(n => !isNaN(n)),
        codecs: [],
      };
      media.push(currentMedia);
    } else if (type === 'a' && currentMedia) {
      parseMediaAttribute(value, currentMedia);
    }
  }

  return { connectionAddress, media, raw };
}

function parseMediaAttribute(value: string, media: SdpMedia): void {
  if (value.startsWith('rtpmap:')) {
    // rtpmap:104 SILK/16000
    const m = /^rtpmap:(\d+)\s+([^/]+)\/(\d+)(.*)$/.exec(value);
    if (m) {
      media.codecs.push({
        payloadType: parseInt(m[1]),
        name: m[2],
        clockRate: parseInt(m[3]),
        parameters: m[4]?.trim() || undefined,
      });
    }
  } else if (value === 'sendrecv' || value === 'sendonly' || value === 'recvonly' || value === 'inactive') {
    media.direction = value;
  } else if (value.startsWith('ptime:')) {
    media.ptime = parseInt(value.substring(6));
  }
}

/**
 * Extract key SIP header values commonly used in correlation.
 */
export function getCallId(headers: Map<string, string[]>): string | undefined {
  return headers.get('call-id')?.[0];
}

export function getCSeq(headers: Map<string, string[]>): { seq: number; method: string } | undefined {
  const val = headers.get('cseq')?.[0];
  if (!val) return undefined;
  const parts = val.trim().split(/\s+/);
  if (parts.length < 2) return undefined;
  return { seq: parseInt(parts[0]), method: parts[1] };
}

export function getFromTag(headers: Map<string, string[]>): string | undefined {
  const from = headers.get('from')?.[0];
  if (!from) return undefined;
  const m = /;tag=([^;>\s]+)/.exec(from);
  return m?.[1];
}

export function getToTag(headers: Map<string, string[]>): string | undefined {
  const to = headers.get('to')?.[0];
  if (!to) return undefined;
  const m = /;tag=([^;>\s]+)/.exec(to);
  return m?.[1];
}

export function getViaBranch(headers: Map<string, string[]>): string | undefined {
  const via = headers.get('via')?.[0];
  if (!via) return undefined;
  const m = /;branch=([^;>\s]+)/.exec(via);
  return m?.[1];
}

/**
 * Extract a phone number from a SIP URI or tel URI.
 * Handles: sip:+14034783920@host, tel:+14034783920, etc.
 */
export function extractPhoneNumber(uri: string): string | undefined {
  // tel URI
  let m = /tel:([+\d]+)/.exec(uri);
  if (m) return m[1];
  // sip URI with user part
  m = /sip:([+\d]+)@/.exec(uri);
  if (m) return m[1];
  return undefined;
}

/**
 * Extract the display name from a From/To header value.
 * Handles: "Display Name" <sip:...> or just <sip:...>
 */
export function extractDisplayName(headerValue: string): string | undefined {
  const m = /^"([^"]+)"/.exec(headerValue);
  return m?.[1];
}
