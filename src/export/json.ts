/**
 * JSON export — structured call record.
 */

import type { Call } from '../model/types.js';
import { downloadBlob } from './svg.js';

export function exportJson(call: Call, filename: string): void {
  // Serialize with Maps converted to objects
  const data = serializeCall(call);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${filename}.json`);
}

function serializeCall(call: Call): any {
  return {
    cid: call.cid,
    callingNumber: call.callingNumber,
    calledNumber: call.calledNumber,
    startTime: call.startTime,
    endTime: call.endTime,
    duration: call.duration,
    status: call.status,
    finalResponseCode: call.finalResponseCode,
    isOptions: call.isOptions,
    findings: call.findings,
    legs: call.legs.map(leg => ({
      direction: leg.direction,
      signalingGroup: leg.signalingGroup,
      sessionType: leg.sessionType,
      callId: leg.callId,
      fromTag: leg.fromTag,
      toTag: leg.toTag,
      remoteAddr: leg.remoteAddr,
      remoteLabel: leg.remoteLabel,
      messages: leg.messages.map(msg => ({
        id: msg.id,
        type: msg.type,
        method: msg.method,
        statusCode: msg.statusCode,
        reasonPhrase: msg.reasonPhrase,
        requestUri: msg.requestUri,
        headers: Object.fromEntries(msg.headers),
        sdp: msg.sdp ? {
          connectionAddress: msg.sdp.connectionAddress,
          media: msg.sdp.media,
        } : undefined,
        timestamp: msg.timestamp,
        direction: msg.direction,
        smmType: msg.smmType,
        cid: msg.cid,
        signalingGroup: msg.signalingGroup,
        startLine: msg.startLine,
        endLine: msg.endLine,
      })),
    })),
  };
}
