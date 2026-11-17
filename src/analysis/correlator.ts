/**
 * Call correlator — groups parsed SIP messages into calls by CID.
 *
 * Primary correlation key: CID (Conference/Call ID) from Ribbon SBC log context.
 * Within each CID:
 *   - InviteServer messages → ingress leg
 *   - InviteClient messages → egress leg
 *   - Each leg has its own SIP Call-ID (B2BUA)
 *
 * OPTIONS/REGISTER are grouped separately and hidden by default.
 */

import type { SipMessage, Call, CallLeg, Finding } from '../model/types.js';
import { getCallId, getCSeq, getFromTag, getToTag, extractPhoneNumber } from '../parser/sip-parser.js';

export interface CorrelationResult {
  calls: Call[];
  unmatchedMessages: SipMessage[];
  warnings: string[];
}

/**
 * Correlate an array of SIP messages into calls.
 */
export function correlateMessages(messages: SipMessage[]): CorrelationResult {
  const warnings: string[] = [];
  const cidGroups = new Map<number, SipMessage[]>();
  const unmatchedMessages: SipMessage[] = [];

  // Phase 1: Build a SIP Call-ID → CID mapping from messages that have both.
  // Used by Phase 2 to assign CIDs to messages that lack one entirely.
  // Phase 4 handles the harder problem of correcting *wrong* CIDs.
  const callIdToCid = new Map<string, number>();
  for (const msg of messages) {
    const sipCallId = getCallId(msg.headers);
    if (sipCallId && msg.cid !== undefined && msg.cid !== 0) {
      callIdToCid.set(sipCallId, msg.cid);
    }
  }

  // Phase 2: Assign CID to messages that lack one but share a SIP Call-ID
  for (const msg of messages) {
    if (msg.cid === undefined || msg.cid === 0) {
      const sipCallId = getCallId(msg.headers);
      if (sipCallId && callIdToCid.has(sipCallId)) {
        msg.cid = callIdToCid.get(sipCallId)!;
      }
    }
  }

  // Phase 3: Group messages by CID
  for (const msg of messages) {
    if (msg.cid !== undefined && msg.cid !== 0) {
      let group = cidGroups.get(msg.cid);
      if (!group) {
        group = [];
        cidGroups.set(msg.cid, group);
      }
      group.push(msg);
    } else {
      unmatchedMessages.push(msg);
    }
  }

  // Phase 4: Rescue INVITE-related messages with stale CIDs.
  // The SBC assigns the CID after processing the initial INVITE, so early
  // messages (INVITE request, 100 Trying) inherit the previous session's
  // stale CID.  We detect this by grouping all messages by SIP Call-ID
  // into dialogs.  When a dialog spans multiple CID groups, the correct
  // CID is from the LATEST message (AddSession always fires after the
  // initial messages).  Only INVITE-related messages are moved — OPTIONS
  // dialogs stay in their original groups.
  const dialogs = new Map<string, SipMessage[]>();

  // Collect all grouped messages into dialogs by SIP Call-ID
  for (const [_cid, msgs] of cidGroups) {
    for (const m of msgs) {
      const sipCallId = getCallId(m.headers);
      if (!sipCallId) continue;
      let dialog = dialogs.get(sipCallId);
      if (!dialog) {
        dialog = [];
        dialogs.set(sipCallId, dialog);
      }
      dialog.push(m);
    }
  }

  // For each dialog spanning multiple CID groups, rescue INVITE-related
  // messages from stale CID groups into the correct one.
  for (const [sipCallId, dialogMsgs] of dialogs) {
    // Quick check: do all messages share the same CID?
    const firstCid = dialogMsgs[0].cid!;
    const mixed = dialogMsgs.some(m => m.cid !== firstCid);
    if (!mixed) continue;

    // The correct CID is from the chronologically latest message
    let latestMsg = dialogMsgs[0];
    for (const m of dialogMsgs) {
      if (m.timestamp > latestMsg.timestamp) latestMsg = m;
    }
    const correctCid = latestMsg.cid!;

    const targetGroup = cidGroups.get(correctCid);
    if (!targetGroup) continue;

    // Only move INVITE-related messages: INVITE requests and responses
    // with CSeq INVITE (100 Trying, 180 Ringing, 200 OK to INVITE, etc.)
    for (const m of dialogMsgs) {
      if (m.cid === correctCid) continue;

      const isInviteRelated =
        (m.method === 'INVITE' && m.type === 'request') ||
        (m.type === 'response' && (() => {
          const cseq = getCSeq(m.headers);
          return cseq && cseq.method === 'INVITE';
        })());

      if (!isInviteRelated) continue;

      const oldGroup = cidGroups.get(m.cid!);
      if (oldGroup) {
        const idx = oldGroup.indexOf(m);
        if (idx !== -1) oldGroup.splice(idx, 1);
      }
      m.cid = correctCid;
      targetGroup.push(m);
    }
  }

  // Clean up empty groups left behind after moving messages
  for (const [cid, msgs] of cidGroups) {
    if (msgs.length === 0) cidGroups.delete(cid);
  }

  // Build calls from CID groups
  const calls: Call[] = [];

  for (const [cid, msgs] of cidGroups) {
    const call = buildCall(cid, msgs, warnings);
    calls.push(call);
  }

  // Sort calls by start time
  calls.sort((a, b) => a.startTime - b.startTime);

  return { calls, unmatchedMessages, warnings };
}

function buildCall(cid: number, messages: SipMessage[], warnings: string[]): Call {
  // Sort all messages by timestamp
  messages.sort((a, b) => a.timestamp - b.timestamp);

  // Split into legs by session type
  const ingressMsgs: SipMessage[] = [];
  const egressMsgs: SipMessage[] = [];
  const otherMsgs: SipMessage[] = [];

  for (const msg of messages) {
    if (msg.sessionType === 'InviteServer') {
      ingressMsgs.push(msg);
    } else if (msg.sessionType === 'InviteClient') {
      egressMsgs.push(msg);
    } else if (msg.sessionType === 'OptionsClient' || msg.sessionType === 'OptionsServerSession') {
      otherMsgs.push(msg);
    } else {
      // Try to infer from context — messages right before/after session context
      otherMsgs.push(msg);
    }
  }

  // Check if this is an OPTIONS session
  const isOptions = ingressMsgs.length === 0 && egressMsgs.length === 0 &&
    messages.some(m => m.method === 'OPTIONS');

  // Build legs
  const legs: CallLeg[] = [];

  if (ingressMsgs.length > 0 || (!isOptions && otherMsgs.length > 0 && egressMsgs.length === 0)) {
    // Use session-typed messages if available, else all untyped messages form a single leg
    const legMsgs = ingressMsgs.length > 0 ? ingressMsgs : otherMsgs;
    const leg = buildLeg('ingress', legMsgs, messages);
    if (leg) legs.push(leg);
  }

  if (egressMsgs.length > 0) {
    const leg = buildLeg('egress', egressMsgs, messages);
    if (leg) legs.push(leg);
  }

  // Extract calling/called numbers from first INVITE (prefer wire copy, fall back to any)
  let callingNumber: string | undefined;
  let calledNumber: string | undefined;
  const firstInvite = messages.find(m => m.method === 'INVITE' && m.smmType === 'wire')
    ?? messages.find(m => m.method === 'INVITE');
  if (firstInvite) {
    const fromHeader = firstInvite.headers.get('from')?.[0];
    const toHeader = firstInvite.headers.get('to')?.[0];
    if (fromHeader) callingNumber = extractPhoneNumber(fromHeader);
    if (toHeader) calledNumber = extractPhoneNumber(toHeader);
    if (!calledNumber && firstInvite.requestUri) {
      calledNumber = extractPhoneNumber(firstInvite.requestUri);
    }
  }

  // Determine call status
  const allWire = messages.filter(m => m.smmType === 'wire');
  const finalResponses = allWire.filter(m =>
    m.type === 'response' && m.statusCode !== undefined && m.statusCode >= 200
  );
  const successResponse = finalResponses.find(m => m.statusCode! >= 200 && m.statusCode! < 300);
  const errorResponse = finalResponses.find(m => m.statusCode! >= 400);

  let status: Call['status'] = 'in-progress';
  let finalResponseCode: number | undefined;

  if (successResponse) {
    // Check if call was properly torn down (BYE seen)
    const hasBye = allWire.some(m => m.method === 'BYE');
    status = hasBye ? 'success' : 'success';
    finalResponseCode = successResponse.statusCode;
  } else if (errorResponse) {
    status = 'failed';
    finalResponseCode = errorResponse.statusCode;
  } else if (allWire.some(m => m.type === 'response' && m.statusCode !== undefined && m.statusCode < 200)) {
    status = 'partial';
  }

  // Derive timing from leg messages when legs exist.  The SBC reuses CID
  // slots, so allMessages may include unrelated OPTIONS sessions from hours
  // earlier.  Leg display messages represent the actual call dialog.
  const timingMsgs = legs.length > 0
    ? legs.flatMap(l => l.messages).sort((a, b) => a.timestamp - b.timestamp)
    : messages;
  const startTime = timingMsgs[0]?.timestamp ?? (messages[0]?.timestamp ?? 0);
  const endTime = timingMsgs[timingMsgs.length - 1]?.timestamp ?? startTime;
  const duration = endTime > startTime ? endTime - startTime : undefined;

  return {
    cid,
    legs,
    callingNumber,
    calledNumber,
    startTime,
    endTime,
    duration,
    status,
    finalResponseCode,
    isOptions,
    allMessages: messages,
    findings: [],
  };
}

function buildLeg(
  direction: 'ingress' | 'egress',
  legMsgs: SipMessage[],
  allMsgs: SipMessage[],
): CallLeg | null {
  if (legMsgs.length === 0) return null;

  // Get the wire copies for this leg
  const wireMsgs = legMsgs.filter(m => m.smmType === 'wire');
  // Also include SMM copies that belong to this leg for reference
  const allLegMsgs = legMsgs;

  // Determine leg properties from first message with enough context
  const firstMsg = legMsgs[0];
  const sg = firstMsg.signalingGroup ?? 0;
  const sessionType = direction === 'ingress' ? 'InviteServer' as const : 'InviteClient' as const;

  // Get SIP Call-ID from wire messages
  let callId = '';
  for (const m of wireMsgs) {
    const id = getCallId(m.headers);
    if (id) {
      callId = id;
      break;
    }
  }
  // Fallback to any message on this leg
  if (!callId) {
    for (const m of legMsgs) {
      const id = getCallId(m.headers);
      if (id) {
        callId = id;
        break;
      }
    }
  }

  // Get tags
  let fromTag: string | undefined;
  let toTag: string | undefined;
  for (const m of legMsgs) {
    if (!fromTag) fromTag = getFromTag(m.headers);
    if (!toTag) toTag = getToTag(m.headers);
    if (fromTag && toTag) break;
  }

  // Determine remote address
  let remoteAddr: string | undefined;
  let remoteLabel: string | undefined;
  for (const m of wireMsgs) {
    if (m.transport) {
      if (m.direction === 'received') {
        remoteAddr = m.transport.remoteAddr;
      } else {
        remoteAddr = m.transport.remoteAddr;
      }
      break;
    }
  }

  // IP-based identification is authoritative — check first
  if (remoteAddr) {
    remoteLabel = identifyByIp(remoteAddr);
  }

  // Fall back to User-Agent / Server header from received wire copies.
  // Skip this if IP already identified the peer (IP ranges are definitive;
  // UA/Server headers can leak from the wrong side via SMM or B2BUA).
  if (!remoteLabel) {
    for (const m of wireMsgs) {
      if (m.direction !== 'received') continue;
      const ua = m.headers.get('user-agent')?.[0] ?? m.headers.get('server')?.[0];
      if (!ua) continue;
      // Skip bare protocol identifiers like "SIP/2.0" — not informative
      if (/^SIP\/\d/i.test(ua)) continue;
      if (ua.includes('Microsoft')) remoteLabel = 'Microsoft Teams';
      else if (ua.includes('CUCM') || ua.includes('Cisco')) remoteLabel = 'CUCM';
      else if (ua.includes('Asterisk')) remoteLabel = 'Asterisk';
      else if (ua.includes('SONUS') || ua.includes('Ribbon')) remoteLabel = 'Ribbon SBC';
      else remoteLabel = ua.split('/')[0].trim();
      break;
    }
  }

  // If still no label or the label is the SBC's own identity, use a
  // generic label — "Ribbon SBC" for a remote peer means we picked
  // up the wrong side's headers.
  if (remoteLabel === 'Ribbon SBC') {
    remoteLabel = undefined;
  }
  if (!remoteLabel && remoteAddr) {
    remoteLabel = 'SIP Peer';
  }

  // Build the display message list from wire copies.  The SBC reuses CID
  // slots, so the leg may contain OPTIONS messages from unrelated sessions
  // that inherited the same sessionType via sticky context.  Filter display
  // messages to the leg's SIP Call-ID dialog to exclude strays.
  let displayMsgs = wireMsgs.length > 0 ? [...wireMsgs] : legMsgs;
  if (callId && displayMsgs.length > 0) {
    const dialogMsgs = displayMsgs.filter(m => {
      const id = getCallId(m.headers);
      return !id || id === callId;
    });
    // Only apply the filter if it doesn't empty the list
    if (dialogMsgs.length > 0) {
      displayMsgs = dialogMsgs;
    }
  }

  // Ensure the initial INVITE (CSeq 1) is always present.  The received
  // INVITE wire copy often has a stale sessionType (e.g. OptionsClient)
  // because the SBC assigns the CID after processing the initial INVITE,
  // so it ends up classified outside the leg's session-typed messages.
  // Re-INVITEs (CSeq >= 2) don't count — we specifically need CSeq 1.
  if (displayMsgs.length > 0) {
    const expectedDir = direction === 'ingress' ? 'received' : 'sent';
    const isInitialInvite = (m: SipMessage) => {
      if (m.method !== 'INVITE' || m.type !== 'request' || m.direction !== expectedDir) return false;
      const cseq = getCSeq(m.headers);
      return !cseq || cseq.seq === 1;
    };
    const hasInitialInvite = displayMsgs.some(isInitialInvite);
    if (!hasInitialInvite) {
      // Search legMsgs first (same session type, any smmType), then
      // fall back to allMsgs (the INVITE may lack a session type or
      // be attributed to a different one due to stale CID).
      const invite =
        legMsgs.find(isInitialInvite) ??
        allMsgs.find(isInitialInvite);
      if (invite) {
        displayMsgs = [invite, ...displayMsgs];
      }
    }
  }

  return {
    direction,
    signalingGroup: sg,
    sessionType,
    callId,
    fromTag,
    toTag,
    remoteAddr,
    remoteLabel,
    messages: displayMsgs,
  };
}

/**
 * Identify a remote peer by IP address against known ranges.
 */
function identifyByIp(addr: string): string | undefined {
  // Microsoft Teams / SBC media relay ranges
  if (addr.includes(':') && addr.startsWith('2603:1063:')) return 'Microsoft Teams';
  const parts = addr.split('.').map(Number);
  if (parts.length === 4 && parts[0] === 52) {
    if (parts[1] >= 112 && parts[1] <= 115) return 'Microsoft Teams';
    if (parts[1] >= 122 && parts[1] <= 123) return 'Microsoft Teams';
  }
  return undefined;
}
