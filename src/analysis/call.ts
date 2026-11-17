/**
 * Call model utilities — helpers for working with Call objects.
 */

import type { Call, SipMessage, CallLeg } from '../model/types.js';
import { formatTime, formatRelativeTime } from '../parser/timestamp.js';
import { getCSeq } from '../parser/sip-parser.js';

/**
 * Get a human-readable summary string for a call.
 */
export function callSummary(call: Call): string {
  const from = call.callingNumber ?? 'Unknown';
  const to = call.calledNumber ?? 'Unknown';
  const time = formatTime(call.startTime);
  const dur = call.duration !== undefined ? ` (${formatRelativeTime(call.duration)})` : '';
  const status = call.status === 'success' ? '200 OK' :
    call.status === 'failed' ? `${call.finalResponseCode ?? 'Error'}` :
    call.status;
  return `${time} ${from} → ${to} [${status}]${dur}`;
}

/**
 * Get participant labels for the ladder diagram.
 * Returns [leftParticipant, centerParticipant, rightParticipant] where
 * center is always the SBC.
 */
export function getParticipants(call: Call): { label: string; addr?: string }[] {
  const participants: { label: string; addr?: string }[] = [];
  const ingressLeg = call.legs.find(l => l.direction === 'ingress');
  const egressLeg = call.legs.find(l => l.direction === 'egress');

  if (ingressLeg) {
    const label = ingressLeg.remoteLabel ?? ingressLeg.remoteAddr ?? `SG(${ingressLeg.signalingGroup})`;
    participants.push({ label, addr: ingressLeg.remoteAddr });
  }

  participants.push({ label: 'Ribbon SBC' });

  if (egressLeg) {
    const label = egressLeg.remoteLabel ?? egressLeg.remoteAddr ?? `SG(${egressLeg.signalingGroup})`;
    participants.push({ label, addr: egressLeg.remoteAddr });
  }

  return participants;
}

/**
 * Build a time-ordered sequence of events for the ladder diagram.
 * Each event is a message with its leg assignment.
 */
export interface LadderEvent {
  message: SipMessage;
  leg: CallLeg;
  legIndex: number;
  /** Column index of the sender */
  fromCol: number;
  /** Column index of the receiver */
  toCol: number;
  /** Label to show on the arrow */
  label: string;
  /** Relative time from call start */
  relativeTime: number;
}

export function buildLadderEvents(call: Call): LadderEvent[] {
  const events: LadderEvent[] = [];
  const ingressLeg = call.legs.find(l => l.direction === 'ingress');
  const egressLeg = call.legs.find(l => l.direction === 'egress');

  // Column layout: [ingress peer] [SBC] [egress peer]
  // Col 0 = ingress peer, Col 1 = SBC, Col 2 = egress peer

  for (const leg of call.legs) {
    const legIndex = call.legs.indexOf(leg);

    for (const msg of leg.messages) {
      let fromCol: number;
      let toCol: number;

      if (leg.direction === 'ingress') {
        if (msg.direction === 'received') {
          // Ingress received = from peer (0) to SBC (1)
          fromCol = 0;
          toCol = 1;
        } else {
          // Ingress sent = from SBC (1) to peer (0)
          fromCol = 1;
          toCol = 0;
        }
      } else {
        // Egress
        if (msg.direction === 'sent') {
          // Egress sent = from SBC (1) to peer (2)
          fromCol = 1;
          toCol = 2;
        } else {
          // Egress received = from peer (2) to SBC (1)
          fromCol = 2;
          toCol = 1;
        }
      }

      const label = msg.type === 'request'
        ? msg.method ?? '?'
        : `${msg.statusCode} ${msg.reasonPhrase ?? ''}`.trim();

      events.push({
        message: msg,
        leg,
        legIndex,
        fromCol,
        toCol,
        label,
        relativeTime: msg.timestamp - call.startTime,
      });
    }
  }

  events.sort((a, b) => {
    // Same leg, same CSeq transaction: a request always precedes its
    // provisional responses.  The SBC can log the auto-generated 100 Trying
    // wire copy before the inbound INVITE wire copy even though the INVITE
    // arrived first.  We restrict this to matching CSeq seq numbers so a BYE
    // (request) doesn't get pulled before an earlier transaction's 1xx.
    if (a.leg === b.leg) {
      const aIsReq = a.message.type === 'request';
      const bIsReq = b.message.type === 'request';
      const aIs1xx = a.message.type === 'response' && a.message.statusCode !== undefined && a.message.statusCode < 200;
      const bIs1xx = b.message.type === 'response' && b.message.statusCode !== undefined && b.message.statusCode < 200;
      if ((aIsReq && bIs1xx) || (bIsReq && aIs1xx)) {
        const aCSeq = getCSeq(a.message.headers);
        const bCSeq = getCSeq(b.message.headers);
        if (aCSeq && bCSeq && aCSeq.seq === bCSeq.seq) {
          if (aIsReq && bIs1xx) return -1;
          if (bIsReq && aIs1xx) return 1;
        }
      }
    }
    return a.message.timestamp - b.message.timestamp;
  });
  return events;
}
