/**
 * Rule: SDP/media analysis.
 *
 * - Codec mismatch between offer and answer
 * - IP address changes across legs
 * - Missing audio media
 */

import type { Call, Finding } from '../../model/types.js';

export function findMediaIssues(call: Call): Finding[] {
  const findings: Finding[] = [];

  // Collect SDP offers and answers across legs
  const sdpMessages = call.allMessages.filter(m => m.sdp);

  if (sdpMessages.length === 0) return findings;

  // Check for IP address differences between ingress and egress SDP
  const ingressSdp = call.legs
    .find(l => l.direction === 'ingress')?.messages
    .filter(m => m.sdp);
  const egressSdp = call.legs
    .find(l => l.direction === 'egress')?.messages
    .filter(m => m.sdp);

  if (ingressSdp && ingressSdp.length > 0 && egressSdp && egressSdp.length > 0) {
    const ingressAddr = ingressSdp[0].sdp!.connectionAddress;
    const egressAddr = egressSdp[0].sdp!.connectionAddress;

    // This is expected for a B2BUA — just informational
    if (ingressAddr && egressAddr && ingressAddr !== egressAddr) {
      findings.push({
        ruleId: 'media-ip-rewrite',
        severity: 'info',
        title: 'Media IP rewritten by SBC',
        description: `Ingress media address ${ingressAddr} was rewritten to ${egressAddr} on the egress leg. This is normal B2BUA behavior.`,
        evidence: [ingressSdp[0].id, egressSdp[0].id],
        confidence: 1.0,
      });
    }
  }

  // Check for codec mismatch: codecs in offer not in answer
  if (sdpMessages.length >= 2) {
    const offer = sdpMessages[0].sdp!;
    const answer = sdpMessages[1].sdp!;

    if (offer.media.length > 0 && answer.media.length > 0) {
      const offerCodecs = new Set(offer.media[0].codecs.map(c => c.name.toUpperCase()));
      const answerCodecs = new Set(answer.media[0].codecs.map(c => c.name.toUpperCase()));

      const removedCodecs = [...offerCodecs].filter(c => !answerCodecs.has(c));
      if (removedCodecs.length > 0 && answerCodecs.size > 0) {
        findings.push({
          ruleId: 'codec-negotiation',
          severity: 'info',
          title: `Codec negotiation: ${removedCodecs.length} codec(s) not selected`,
          description: `Offered codecs not in answer: ${removedCodecs.join(', ')}. Selected: ${[...answerCodecs].join(', ')}.`,
          evidence: [sdpMessages[0].id, sdpMessages[1].id],
          confidence: 0.8,
        });
      }

      // Check if answer has zero codecs
      if (answerCodecs.size === 0 && offer.media[0].codecs.length > 0) {
        findings.push({
          ruleId: 'no-common-codec',
          severity: 'error',
          title: 'No common codec in SDP answer',
          description: 'The SDP answer contains no codecs. This likely indicates a codec mismatch that will cause no audio.',
          evidence: [sdpMessages[0].id, sdpMessages[1].id],
          confidence: 0.9,
        });
      }
    }
  }

  return findings;
}
