/**
 * Rule: Detect timeout conditions.
 *
 * - INVITE without any final response (>= 200)
 * - Long gap between provisional and final response
 */

import type { Call, Finding } from '../../model/types.js';
import { getCSeq } from '../../parser/sip-parser.js';

const LONG_PROVISIONAL_GAP_MS = 30_000; // 30 seconds

export function findTimeouts(call: Call): Finding[] {
  const findings: Finding[] = [];

  for (const leg of call.legs) {
    // Only consider initial INVITE requests (CSeq 1), not re-INVITEs
    const initialInvite = leg.messages.find(m => {
      if (m.method !== 'INVITE' || m.type !== 'request') return false;
      const cseq = getCSeq(m.headers);
      return !cseq || cseq.seq === 1;
    });

    // Final responses to INVITE only (not BYE, ACK, etc.)
    const inviteFinalResponses = leg.messages.filter(m => {
      if (m.type !== 'response' || m.statusCode === undefined || m.statusCode < 200) return false;
      const cseq = getCSeq(m.headers);
      return cseq && cseq.method === 'INVITE';
    });

    if (initialInvite && inviteFinalResponses.length === 0) {
      // Check if there are any provisional responses
      const provisionals = leg.messages.filter(m =>
        m.type === 'response' && m.statusCode !== undefined && m.statusCode < 200
      );

      findings.push({
        ruleId: 'no-final-response',
        severity: 'error',
        title: `No final response on ${leg.direction} leg`,
        description: `INVITE on ${leg.direction} leg (SG ${leg.signalingGroup}) has ${provisionals.length} provisional response(s) but no final response (>= 200). The call may have timed out or the response was not captured.`,
        evidence: [initialInvite.id],
        confidence: 0.8,
      });
    }

    // Check for long INVITE-to-final-response gaps (call setup time)
    if (initialInvite && inviteFinalResponses.length > 0) {
      const provisionals = leg.messages.filter(m =>
        m.type === 'response' && m.statusCode !== undefined && m.statusCode < 200
      );

      if (provisionals.length > 0) {
        const firstFinal = inviteFinalResponses[0];
        const gap = firstFinal.timestamp - initialInvite.timestamp;

        if (gap > LONG_PROVISIONAL_GAP_MS) {
          findings.push({
            ruleId: 'long-setup-time',
            severity: 'warning',
            title: `Slow call setup (${(gap / 1000).toFixed(1)}s)`,
            description: `${leg.direction} leg took ${(gap / 1000).toFixed(1)}s from INVITE to final response. This may indicate network latency, slow routing, or a delayed answer.`,
            evidence: [initialInvite.id, firstFinal.id],
            confidence: 0.7,
          });
        }
      }
    }
  }

  return findings;
}
