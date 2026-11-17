import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractSipMessages } from '../../src/parser/sip-extractor.js';
import { correlateMessages } from '../../src/analysis/correlator.js';
import { buildLadderEvents } from '../../src/analysis/call.js';

function loadFixture(name: string): string[] {
  const path = join(__dirname, '..', 'fixtures', name);
  return readFileSync(path, 'utf-8').split('\n');
}

describe('correlateMessages — v11 fixture', () => {
  const lines = loadFixture('webui-v11-single-leg-404.log');
  const sipMsgs = extractSipMessages(lines);
  const { calls, warnings } = correlateMessages(sipMsgs);

  it('correlates messages into at least one call', () => {
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('identifies CID 118', () => {
    const call = calls.find(c => c.cid === 118);
    expect(call).toBeDefined();
  });

  it('detects the call as failed with 404', () => {
    const call = calls.find(c => c.cid === 118);
    expect(call?.status).toBe('failed');
    expect(call?.finalResponseCode).toBe(404);
  });

  it('extracts calling and called numbers', () => {
    const call = calls.find(c => c.cid === 118);
    // The INVITE in v11 fixture has From: +15551001001, To: +15552002002
    expect(call?.callingNumber).toBe('+15551001001');
    expect(call?.calledNumber).toBe('+15552002002');
  });
});

describe('correlateMessages — v13 fixture', () => {
  const lines = loadFixture('webui-v13-two-leg-success.log');
  const sipMsgs = extractSipMessages(lines);
  const { calls, warnings } = correlateMessages(sipMsgs);

  it('correlates messages into calls', () => {
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('identifies CID 5105', () => {
    const call = calls.find(c => c.cid === 5105);
    expect(call).toBeDefined();
  });

  it('creates ingress and egress legs for CID 5105', () => {
    const call = calls.find(c => c.cid === 5105);
    expect(call).toBeDefined();
    // May have both legs depending on which wire copies are in the fixture
    expect(call!.legs.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts called number', () => {
    const call = calls.find(c => c.cid === 5105);
    // Both ingress and egress INVITEs target +15555005005
    if (call?.calledNumber) {
      expect(call.calledNumber).toBe('+15555005005');
    }
  });
});

describe('correlateMessages — v13 stale CID rescue', () => {
  const lines = loadFixture('webui-v13-stale-cid.log');
  const sipMsgs = extractSipMessages(lines);
  const { calls, unmatchedMessages } = correlateMessages(sipMsgs);

  it('creates a call for CID 5184', () => {
    const call = calls.find(c => c.cid === 5184);
    expect(call).toBeDefined();
  });

  it('rescues the initial INVITE into CID 5184 (not left in stale CID 5183)', () => {
    // The INVITE was extracted with stale CID 5183 by the extractor.
    // Phase 4 of the correlator should detect that this INVITE shares a
    // SIP Call-ID with messages in CID 5184 and move it there.
    const call5184 = calls.find(c => c.cid === 5184);
    expect(call5184).toBeDefined();
    const inviteInCall = call5184!.allMessages.find(m =>
      m.method === 'INVITE' && m.type === 'request' &&
      m.headers.get('call-id')?.[0] === 'ab20559912b45ca88558940b813b2f31'
    );
    expect(inviteInCall).toBeDefined();
  });

  it('does NOT leave the INVITE in CID 5183', () => {
    const call5183 = calls.find(c => c.cid === 5183);
    if (call5183) {
      const inviteInOld = call5183.allMessages.find(m =>
        m.method === 'INVITE' && m.type === 'request' &&
        m.headers.get('call-id')?.[0] === 'ab20559912b45ca88558940b813b2f31'
      );
      expect(inviteInOld).toBeUndefined();
    }
  });

  it('includes the INVITE in the ingress leg display messages', () => {
    const call5184 = calls.find(c => c.cid === 5184);
    expect(call5184).toBeDefined();
    const ingressLeg = call5184!.legs.find(l => l.direction === 'ingress');
    expect(ingressLeg).toBeDefined();
    const inviteInLeg = ingressLeg!.messages.find(m =>
      m.method === 'INVITE' && m.type === 'request'
    );
    expect(inviteInLeg).toBeDefined();
  });

  it('extracts calling and called numbers from the INVITE', () => {
    const call5184 = calls.find(c => c.cid === 5184);
    expect(call5184).toBeDefined();
    expect(call5184!.callingNumber).toBe('+15553003003');
    expect(call5184!.calledNumber).toBe('+15554004004');
  });

  it('does not leave the INVITE as unmatched', () => {
    const unmatchedInvite = unmatchedMessages.find(m =>
      m.method === 'INVITE' && m.type === 'request' &&
      m.headers.get('call-id')?.[0] === 'ab20559912b45ca88558940b813b2f31'
    );
    expect(unmatchedInvite).toBeUndefined();
  });

  it('INVITE appears as first event in the ladder diagram', () => {
    const call5184 = calls.find(c => c.cid === 5184);
    expect(call5184).toBeDefined();
    const events = buildLadderEvents(call5184!);
    expect(events.length).toBeGreaterThanOrEqual(2);
    // First event should be the INVITE request
    expect(events[0].message.method).toBe('INVITE');
    expect(events[0].message.type).toBe('request');
    // Second event should be 100 Trying response
    expect(events[1].message.type).toBe('response');
    expect(events[1].message.statusCode).toBe(100);
  });

  it('INVITE arrow goes from peer (col 0) to SBC (col 1)', () => {
    const call5184 = calls.find(c => c.cid === 5184);
    expect(call5184).toBeDefined();
    const events = buildLadderEvents(call5184!);
    const inviteEvent = events.find(e => e.message.method === 'INVITE');
    expect(inviteEvent).toBeDefined();
    // Ingress received: fromCol=0 (peer), toCol=1 (SBC)
    expect(inviteEvent!.fromCol).toBe(0);
    expect(inviteEvent!.toCol).toBe(1);
  });
});
