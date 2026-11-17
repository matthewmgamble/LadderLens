/**
 * SIP dialog tracking per leg.
 *
 * Tracks dialog state: Call-ID + From-tag + To-tag.
 * Matches requests to responses via CSeq + branch.
 * Detects retransmissions (same branch, same CSeq).
 */

import type { SipMessage } from '../model/types.js';
import { getCallId, getCSeq, getFromTag, getToTag, getViaBranch } from '../parser/sip-parser.js';

export interface DialogState {
  callId: string;
  fromTag: string;
  toTag?: string;
  state: 'early' | 'confirmed' | 'terminated';
}

export interface TransactionMatch {
  request: SipMessage;
  responses: SipMessage[];
}

/**
 * Match requests to their responses within a set of messages on a single leg.
 * Uses CSeq method + Via branch for matching.
 */
export function matchTransactions(messages: SipMessage[]): TransactionMatch[] {
  const transactions: TransactionMatch[] = [];
  const requestMap = new Map<string, TransactionMatch>();

  for (const msg of messages) {
    const cseq = getCSeq(msg.headers);
    if (!cseq) continue;

    const branch = getViaBranch(msg.headers) ?? '';
    // Key: branch + CSeq method (branch is unique per transaction)
    const key = `${branch}:${cseq.method}`;

    if (msg.type === 'request') {
      const existing = requestMap.get(key);
      if (existing) {
        // Retransmission — flag it
        (msg as any)._isRetransmission = true;
      } else {
        const tx: TransactionMatch = { request: msg, responses: [] };
        requestMap.set(key, tx);
        transactions.push(tx);
      }
    } else if (msg.type === 'response') {
      // Find matching request by CSeq method (branch may differ in responses)
      const tx = requestMap.get(key);
      if (tx) {
        tx.responses.push(msg);
      } else {
        // Try matching by CSeq method only (some responses may not have matching branch)
        for (const [k, t] of requestMap) {
          if (k.endsWith(`:${cseq.method}`) && t.responses.length === 0) {
            t.responses.push(msg);
            break;
          }
        }
      }
    }
  }

  return transactions;
}

/**
 * Detect retransmissions in a set of messages.
 * Returns message IDs that are retransmissions.
 */
export function detectRetransmissions(messages: SipMessage[]): Set<string> {
  const retransmissions = new Set<string>();
  const seen = new Map<string, string>(); // key → first message ID

  for (const msg of messages) {
    if (msg.type !== 'request') continue;
    const branch = getViaBranch(msg.headers);
    const cseq = getCSeq(msg.headers);
    if (!branch || !cseq) continue;

    const key = `${branch}:${cseq.seq}:${cseq.method}`;
    const existing = seen.get(key);
    if (existing) {
      retransmissions.add(msg.id);
    } else {
      seen.set(key, msg.id);
    }
  }

  return retransmissions;
}
