/**
 * Rule: Detect 4xx/5xx/6xx error responses.
 */

import type { Call, Finding } from '../../model/types.js';

export function findErrorResponses(call: Call): Finding[] {
  const findings: Finding[] = [];

  for (const msg of call.allMessages) {
    if (msg.type !== 'response' || msg.statusCode === undefined) continue;
    if (msg.statusCode < 400) continue;

    const code = msg.statusCode;
    const phrase = msg.reasonPhrase ?? '';
    const leg = call.legs.find(l => l.messages.includes(msg));
    const legLabel = leg ? `${leg.direction} leg (SG ${leg.signalingGroup})` : 'unknown leg';

    let severity: Finding['severity'] = 'warning';
    if (code >= 500) severity = 'error';
    if (code >= 600) severity = 'critical';

    // Add contextual description
    let description = `${code} ${phrase} received on ${legLabel}.`;
    if (code === 404) description += ' The called number was not found at the destination.';
    else if (code === 403) description += ' The call was forbidden — check authentication/authorization.';
    else if (code === 408) description += ' Request timed out waiting for a response.';
    else if (code === 480) description += ' The called party is temporarily unavailable.';
    else if (code === 486) description += ' The called party is busy.';
    else if (code === 487) description += ' The request was terminated (usually by CANCEL).';
    else if (code === 488) description += ' Not acceptable here — possible codec/media mismatch.';
    else if (code === 500) description += ' Internal server error at the destination.';
    else if (code === 503) description += ' Service unavailable — the destination may be down.';

    findings.push({
      ruleId: 'error-response',
      severity,
      title: `${code} ${phrase}`,
      description,
      evidence: [msg.id],
      confidence: 1.0,
    });
  }

  return findings;
}
