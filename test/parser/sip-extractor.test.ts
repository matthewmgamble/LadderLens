import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractSipMessages } from '../../src/parser/sip-extractor.js';

function loadFixture(name: string): string[] {
  const path = join(__dirname, '..', 'fixtures', name);
  return readFileSync(path, 'utf-8').split('\n');
}

describe('extractSipMessages — v11 fixture', () => {
  const lines = loadFixture('webui-v11-single-leg-404.log');
  const messages = extractSipMessages(lines);

  it('extracts SIP messages from v11 log', () => {
    expect(messages.length).toBeGreaterThanOrEqual(3);
  });

  it('finds the INVITE', () => {
    const invite = messages.find(m => m.method === 'INVITE');
    expect(invite).toBeDefined();
    expect(invite!.type).toBe('request');
    expect(invite!.requestUri).toContain('+15552002002');
    expect(invite!.headers.get('call-id')?.[0]).toBe('78d4e5860428681f43e81dc619648e97@198.51.100.50:5060');
    expect(invite!.sdp).toBeDefined();
    expect(invite!.sdp!.media[0].codecs.length).toBeGreaterThan(0);
  });

  it('finds the 404 response', () => {
    const resp = messages.find(m => m.statusCode === 404);
    expect(resp).toBeDefined();
    expect(resp!.type).toBe('response');
    expect(resp!.reasonPhrase).toBe('Not Found');
  });

  it('finds the ACK', () => {
    const ack = messages.find(m => m.method === 'ACK');
    expect(ack).toBeDefined();
    expect(ack!.direction).toBe('received');
  });
});

describe('extractSipMessages — v13 fixture', () => {
  const lines = loadFixture('webui-v13-two-leg-success.log');
  const messages = extractSipMessages(lines);

  it('extracts SIP messages from v13 log', () => {
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it('finds the ingress INVITE (wire copy)', () => {
    // The first INVITE in the fixture is the ingress from Teams (MSGID-based)
    const invites = messages.filter(m => m.method === 'INVITE');
    expect(invites.length).toBeGreaterThanOrEqual(1);
  });

  it('finds INVITE with correct Call-ID', () => {
    const invite = messages.find(m =>
      m.method === 'INVITE' &&
      m.headers.get('call-id')?.[0] === '244249a6119850f98ca67aa86d549a96'
    );
    expect(invite).toBeDefined();
  });

  it('finds egress INVITE with different Call-ID', () => {
    const invite = messages.find(m =>
      m.method === 'INVITE' &&
      m.headers.get('call-id')?.[0]?.startsWith('call-31089CBD')
    );
    expect(invite).toBeDefined();
  });

  it('classifies SMM copies', () => {
    const beforeSmm = messages.filter(m => m.smmType === 'before-smm');
    const smmModified = messages.filter(m => m.smmType === 'smm-modified');
    const wire = messages.filter(m => m.smmType === 'wire');
    // We should have all three types in our fixture
    expect(beforeSmm.length).toBeGreaterThanOrEqual(1);
    expect(smmModified.length).toBeGreaterThanOrEqual(1);
    expect(wire.length).toBeGreaterThanOrEqual(1);
  });
});

describe('extractSipMessages — v13 stale CID fixture', () => {
  const lines = loadFixture('webui-v13-stale-cid.log');
  const messages = extractSipMessages(lines);

  it('extracts at least 4 messages (INVITE wire, INVITE smm, 100 before-smm, 100 wire)', () => {
    expect(messages.length).toBeGreaterThanOrEqual(4);
  });

  it('extracts the initial INVITE with Call-ID ab2055...', () => {
    const invite = messages.find(m =>
      m.method === 'INVITE' && m.type === 'request' &&
      m.headers.get('call-id')?.[0] === 'ab20559912b45ca88558940b813b2f31'
    );
    expect(invite).toBeDefined();
  });

  it('assigns stale CID 5183 to the initial INVITE (not 5184)', () => {
    // The INVITE arrives BEFORE AddSession GCID: 5184 fires.
    // The extractor inherits the previous session's CID 5183.
    const invite = messages.find(m =>
      m.method === 'INVITE' && m.type === 'request' &&
      m.headers.get('call-id')?.[0] === 'ab20559912b45ca88558940b813b2f31' &&
      m.smmType === 'wire'
    );
    expect(invite).toBeDefined();
    // This is the core stale-CID problem: INVITE gets wrong CID
    expect(invite!.cid).toBe(5183);
  });

  it('assigns stale sessionType to the initial INVITE (OptionsClient, not InviteServer)', () => {
    // The OptionsClient context lines appear between CID:5183 and the INVITE,
    // so lastSessionContext is OptionsClient when the INVITE is flushed.
    const invite = messages.find(m =>
      m.method === 'INVITE' && m.type === 'request' &&
      m.headers.get('call-id')?.[0] === 'ab20559912b45ca88558940b813b2f31' &&
      m.smmType === 'wire'
    );
    expect(invite).toBeDefined();
    expect(invite!.sessionType).toBe('OptionsClient');
  });

  it('assigns correct CID 5184 to the wire 100 Trying', () => {
    // The wire 100 Trying is sent AFTER AddSession fires, so it has CID 5184
    const trying = messages.find(m =>
      m.type === 'response' && m.statusCode === 100 && m.smmType === 'wire'
    );
    expect(trying).toBeDefined();
    expect(trying!.cid).toBe(5184);
  });

  it('assigns correct sessionType InviteServer to the wire 100 Trying', () => {
    const trying = messages.find(m =>
      m.type === 'response' && m.statusCode === 100 && m.smmType === 'wire'
    );
    expect(trying).toBeDefined();
    expect(trying!.sessionType).toBe('InviteServer');
  });

  it('extracts the SMM-modified INVITE copy', () => {
    const smmInvite = messages.find(m =>
      m.method === 'INVITE' && m.type === 'request' && m.smmType === 'smm-modified'
    );
    expect(smmInvite).toBeDefined();
    expect(smmInvite!.headers.get('call-id')?.[0]).toBe('ab20559912b45ca88558940b813b2f31');
  });

  it('detects the INVITE as received direction', () => {
    const invite = messages.find(m =>
      m.method === 'INVITE' && m.type === 'request' && m.smmType === 'wire'
    );
    expect(invite).toBeDefined();
    expect(invite!.direction).toBe('received');
  });

  it('detects the wire 100 Trying as sent direction', () => {
    const trying = messages.find(m =>
      m.type === 'response' && m.statusCode === 100 && m.smmType === 'wire'
    );
    expect(trying).toBeDefined();
    expect(trying!.direction).toBe('sent');
  });
});
