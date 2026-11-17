/**
 * Rule: Number/identity transformation detection.
 *
 * - Number rewrite between ingress and egress From header
 * - P-Asserted-Identity changes
 * - Diversion header changes
 */

import type { Call, Finding } from '../../model/types.js';
import { extractPhoneNumber } from '../../parser/sip-parser.js';

export function findIdentityIssues(call: Call): Finding[] {
  const findings: Finding[] = [];

  const ingressLeg = call.legs.find(l => l.direction === 'ingress');
  const egressLeg = call.legs.find(l => l.direction === 'egress');

  if (!ingressLeg || !egressLeg) return findings;

  // Compare From headers on ingress vs egress INVITEs
  const ingressInvite = ingressLeg.messages.find(m => m.method === 'INVITE');
  const egressInvite = egressLeg.messages.find(m => m.method === 'INVITE');

  if (ingressInvite && egressInvite) {
    const ingressFrom = ingressInvite.headers.get('from')?.[0] ?? '';
    const egressFrom = egressInvite.headers.get('from')?.[0] ?? '';
    const ingressNum = extractPhoneNumber(ingressFrom);
    const egressNum = extractPhoneNumber(egressFrom);

    if (ingressNum && egressNum && ingressNum !== egressNum) {
      findings.push({
        ruleId: 'from-rewrite',
        severity: 'info',
        title: `From number rewritten: ${ingressNum} → ${egressNum}`,
        description: `The From header was modified from ${ingressNum} (ingress) to ${egressNum} (egress). This is typically done by SBC number manipulation rules.`,
        evidence: [ingressInvite.id, egressInvite.id],
        confidence: 1.0,
      });
    }

    // Check P-Asserted-Identity
    const ingressPai = ingressInvite.headers.get('p-asserted-identity')?.[0];
    const egressPai = egressInvite.headers.get('p-asserted-identity')?.[0];

    if (ingressPai && egressPai) {
      const inPaiNum = extractPhoneNumber(ingressPai);
      const outPaiNum = extractPhoneNumber(egressPai);
      if (inPaiNum && outPaiNum && inPaiNum !== outPaiNum) {
        findings.push({
          ruleId: 'pai-rewrite',
          severity: 'info',
          title: `PAI rewritten: ${inPaiNum} → ${outPaiNum}`,
          description: `P-Asserted-Identity was modified from ${inPaiNum} to ${outPaiNum} between ingress and egress.`,
          evidence: [ingressInvite.id, egressInvite.id],
          confidence: 1.0,
        });
      }
    } else if (ingressPai && !egressPai) {
      findings.push({
        ruleId: 'pai-stripped',
        severity: 'warning',
        title: 'P-Asserted-Identity stripped on egress',
        description: 'The P-Asserted-Identity header was present on ingress but removed from the egress INVITE. This may cause caller ID issues.',
        evidence: [ingressInvite.id, egressInvite.id],
        confidence: 0.9,
      });
    } else if (!ingressPai && egressPai) {
      findings.push({
        ruleId: 'pai-added',
        severity: 'info',
        title: 'P-Asserted-Identity added on egress',
        description: `The SBC added P-Asserted-Identity: ${extractPhoneNumber(egressPai) ?? egressPai} on the egress leg.`,
        evidence: [ingressInvite.id, egressInvite.id],
        confidence: 1.0,
      });
    }
  }

  return findings;
}
