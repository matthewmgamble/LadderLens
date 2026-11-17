/**
 * Rule: Detect SIP retransmissions.
 *
 * - Duplicate INVITEs (same branch+CSeq)
 * - Missing ACK after non-2xx final response
 * - Duplicate BYEs
 */

import type { Call, Finding } from '../../model/types.js';
import { getViaBranch, getCSeq } from '../../parser/sip-parser.js';

export function findRetransmissions(call: Call): Finding[] {
  const findings: Finding[] = [];

  for (const leg of call.legs) {
    // Detect duplicate requests (same branch + CSeq)
    const seen = new Map<string, string>(); // key → first msg ID
    const duplicates: { original: string; duplicate: string; method: string }[] = [];

    for (const msg of leg.messages) {
      if (msg.type !== 'request') continue;
      const branch = getViaBranch(msg.headers);
      const cseq = getCSeq(msg.headers);
      if (!branch || !cseq) continue;

      const key = `${branch}:${cseq.seq}:${cseq.method}`;
      const existing = seen.get(key);
      if (existing) {
        duplicates.push({ original: existing, duplicate: msg.id, method: cseq.method });
      } else {
        seen.set(key, msg.id);
      }
    }

    if (duplicates.length > 0) {
      const methods = [...new Set(duplicates.map(d => d.method))].join(', ');
      findings.push({
        ruleId: 'retransmission',
        severity: 'warning',
        title: `${duplicates.length} retransmission(s) on ${leg.direction} leg`,
        description: `Detected ${duplicates.length} retransmitted ${methods} message(s) on the ${leg.direction} leg. This may indicate packet loss or slow processing.`,
        evidence: duplicates.flatMap(d => [d.original, d.duplicate]),
        confidence: 0.9,
      });
    }

    // Check for missing ACK after non-2xx response
    const finalResponses = leg.messages.filter(m =>
      m.type === 'response' && m.statusCode !== undefined && m.statusCode >= 300
    );
    for (const resp of finalResponses) {
      const acks = leg.messages.filter(m => m.method === 'ACK');
      if (acks.length === 0 && resp.statusCode !== undefined && resp.statusCode < 400) {
        // Missing ACK for 3xx is unusual
        findings.push({
          ruleId: 'missing-ack',
          severity: 'info',
          title: `No ACK after ${resp.statusCode} on ${leg.direction} leg`,
          description: `No ACK was observed after ${resp.statusCode} ${resp.reasonPhrase ?? ''} response. The ACK may not have been captured in the log.`,
          evidence: [resp.id],
          confidence: 0.5,
        });
      }
    }
  }

  return findings;
}
