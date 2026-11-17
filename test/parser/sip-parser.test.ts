import { describe, it, expect } from 'vitest';
import {
  parseSipMessage,
  parseSdp,
  getCallId,
  getCSeq,
  getFromTag,
  getToTag,
  getViaBranch,
  extractPhoneNumber,
} from '../../src/parser/sip-parser.js';

describe('parseSipMessage', () => {
  it('parses a SIP INVITE request', () => {
    const raw = `INVITE sip:+15552002002@198.51.100.30 SIP/2.0
Via: SIP/2.0/UDP 198.51.100.50:5060;branch=z9hG4bK21e44233
Max-Forwards: 70
From: "f1e04a9d-97d" <sip:+15551001001@198.51.100.50>;tag=as6d5d2c56
To: <sip:+15552002002@198.51.100.30>
Contact: <sip:+15551001001@198.51.100.50:5060>
Call-ID: 78d4e5860428681f43e81dc619648e97@198.51.100.50:5060
CSeq: 102 INVITE
Content-Type: application/sdp
Content-Length: 287

v=0
o=root 640524242 640524242 IN IP4 198.51.100.50
s=Asterisk PBX 16.24.1
c=IN IP4 198.51.100.50
t=0 0
m=audio 16086 RTP/AVP 0 8 3 101
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:3 GSM/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`;

    const result = parseSipMessage(raw);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('request');
    expect(result!.method).toBe('INVITE');
    expect(result!.requestUri).toBe('sip:+15552002002@198.51.100.30');
    expect(getCallId(result!.headers)).toBe('78d4e5860428681f43e81dc619648e97@198.51.100.50:5060');
    expect(getCSeq(result!.headers)).toEqual({ seq: 102, method: 'INVITE' });
    expect(getFromTag(result!.headers)).toBe('as6d5d2c56');
    expect(getViaBranch(result!.headers)).toBe('z9hG4bK21e44233');
    expect(result!.sdp).toBeDefined();
    expect(result!.sdp!.connectionAddress).toBe('198.51.100.50');
    expect(result!.sdp!.media).toHaveLength(1);
    expect(result!.sdp!.media[0].type).toBe('audio');
    expect(result!.sdp!.media[0].port).toBe(16086);
    expect(result!.sdp!.media[0].codecs).toHaveLength(4);
    expect(result!.sdp!.media[0].codecs[0].name).toBe('PCMU');
    expect(result!.sdp!.media[0].direction).toBe('sendrecv');
  });

  it('parses a SIP response', () => {
    const raw = `SIP/2.0 404 Not Found
Via: SIP/2.0/UDP 198.51.100.50:5060;branch=z9hG4bK21e44233;received=198.51.100.50
From: "f1e04a9d-97d" <sip:+15551001001@198.51.100.50>;tag=as6d5d2c56
To: <sip:+15552002002@198.51.100.30>;tag=a05cd04-32947
Call-ID: 78d4e5860428681f43e81dc619648e97@198.51.100.50:5060
CSeq: 102 INVITE
Server: SONUS SBCSWeLite 11.1.0v48 Azure Ribbon SBC Edge
Content-Length: 0`;

    const result = parseSipMessage(raw);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('response');
    expect(result!.statusCode).toBe(404);
    expect(result!.reasonPhrase).toBe('Not Found');
    expect(getToTag(result!.headers)).toBe('a05cd04-32947');
  });

  it('parses a 200 OK response', () => {
    const raw = `SIP/2.0 200 OK
Via: SIP/2.0/TCP 10.21.205.4:5065;branch=z9hG4bK-UX-0a15-cd04-32123b
From: <sip:Anonymous@10.21.205.4:5065>;tag=a15cd04-e26b2;sgid=3
To: <sip:Anonymous@p0cpwpccmsub06.corp.ad.ctc:5065>;tag=1583836366
Call-ID: call-25754DD9-0200-0010-0609-151F5@10.21.205.4
Server: Cisco-CUCM15.0
CSeq: 139525 OPTIONS
Content-Length: 0`;

    const result = parseSipMessage(raw);
    expect(result!.type).toBe('response');
    expect(result!.statusCode).toBe(200);
    expect(result!.reasonPhrase).toBe('OK');
    expect(getCSeq(result!.headers)).toEqual({ seq: 139525, method: 'OPTIONS' });
  });

  it('returns null for non-SIP content', () => {
    expect(parseSipMessage('')).toBeNull();
    expect(parseSipMessage('some random text')).toBeNull();
  });
});

describe('parseSdp', () => {
  it('parses SDP with media-level connection address', () => {
    const raw = `v=0
o=- 150146 0 IN IP4 127.0.0.1
s=session
c=IN IP4 52.115.232.218
t=0 0
m=audio 50332 RTP/SAVP 104 9 0 8 101 13
c=IN IP4 52.115.232.218
a=rtpmap:104 SILK/16000
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:101 telephone-event/8000
a=rtpmap:13 CN/8000
a=ptime:20
a=sendrecv`;

    const result = parseSdp(raw);
    expect(result.connectionAddress).toBe('52.115.232.218');
    expect(result.media).toHaveLength(1);
    expect(result.media[0].port).toBe(50332);
    expect(result.media[0].protocol).toBe('RTP/SAVP');
    expect(result.media[0].codecs.find(c => c.name === 'SILK')?.clockRate).toBe(16000);
    expect(result.media[0].ptime).toBe(20);
    expect(result.media[0].direction).toBe('sendrecv');
  });
});

describe('extractPhoneNumber', () => {
  it('extracts from sip URI', () => {
    expect(extractPhoneNumber('sip:+15551001001@198.51.100.50')).toBe('+15551001001');
  });

  it('extracts from tel URI', () => {
    expect(extractPhoneNumber('tel:+15557007007;ext=29781')).toBe('+15557007007');
  });
});
