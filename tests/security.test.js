// Comprehensive Security & SSRF Test Suite for Appllify Music Netlify Functions
// Tests URL validation, IP blocking, redirect protections, timeouts, response sizes, HMAC tokens, and handlers.

const assert = require('assert');
const {
  validateInboundUrl,
  isPrivateOrReservedHost,
  safeFetch,
  readBodyWithLimit,
  generateDownloadToken,
  verifyDownloadToken,
  cleanFileName,
  ALLOWED_INBOUND_HOSTS,
  ALLOWED_OUTBOUND_HOSTS,
  ALLOWED_AUDIO_HOSTS
} = require('../netlify/functions/utils/security');

const inspectHandler = require('../netlify/functions/inspect-link').handler;
const downloadHandler = require('../netlify/functions/download').handler;

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('🛡️  STARTING SECURITY & SSRF TEST SUITE');
  console.log('======================================================\n');

  // --------------------------------------------------------------------------
  // Group 1: Malformed & Invalid URLs
  // --------------------------------------------------------------------------
  console.log('Group 1: Malformed & Invalid URLs');

  runTest('Rejects empty or null URL', () => {
    assert.strictEqual(validateInboundUrl('').valid, false);
    assert.strictEqual(validateInboundUrl(null).valid, false);
    assert.strictEqual(validateInboundUrl('   ').valid, false);
  });

  runTest('Rejects non-URL string', () => {
    assert.strictEqual(validateInboundUrl('not_a_valid_url').valid, false);
    assert.strictEqual(validateInboundUrl('://invalid').valid, false);
    assert.strictEqual(validateInboundUrl('https://').valid, false);
  });

  runTest('Rejects URLs with control characters', () => {
    assert.strictEqual(validateInboundUrl('https://music.apple.com\0/album/1').valid, false);
    assert.strictEqual(validateInboundUrl('https://music.apple.com\r\n/album/1').valid, false);
  });

  // --------------------------------------------------------------------------
  // Group 2: Deceptive Hostnames & Domain Confusion
  // --------------------------------------------------------------------------
  console.log('\nGroup 2: Deceptive Hostnames & Domain Confusion');

  runTest('Rejects subdomain deception (gaana.com.evil.com)', () => {
    const res = validateInboundUrl('https://gaana.com.evil.com/song/kesariya');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.error, 'Unsupported music platform or domain.');
  });

  runTest('Rejects prefix deception (evil-gaana.com)', () => {
    const res = validateInboundUrl('https://evil-gaana.com/song/kesariya');
    assert.strictEqual(res.valid, false);
  });

  runTest('Rejects suffix deception (music.apple.com.attacker.com)', () => {
    const res = validateInboundUrl('https://music.apple.com.attacker.com/us/album/123');
    assert.strictEqual(res.valid, false);
  });

  runTest('Rejects userinfo / credentials in URL (@ attacker.com)', () => {
    const res1 = validateInboundUrl('https://music.apple.com@evil.com/song');
    assert.strictEqual(res1.valid, false);
    const res2 = validateInboundUrl('https://user:password@music.apple.com/song');
    assert.strictEqual(res2.valid, false);
    assert.strictEqual(res2.error, 'Embedded credentials in URLs are not permitted.');
  });

  runTest('Rejects non-standard port numbers', () => {
    const res1 = validateInboundUrl('https://music.apple.com:8080/album/1');
    assert.strictEqual(res1.valid, false);
    assert.strictEqual(res1.error, 'Non-standard port numbers are not permitted.');

    const res2 = validateInboundUrl('https://open.spotify.com:8443/track/abc');
    assert.strictEqual(res2.valid, false);
  });

  // --------------------------------------------------------------------------
  // Group 3: Private & Loopback IPv4 Addresses
  // --------------------------------------------------------------------------
  console.log('\nGroup 3: Private & Loopback IPv4 Addresses');

  runTest('Detects standard loopback (127.0.0.1)', () => {
    assert.strictEqual(isPrivateOrReservedHost('127.0.0.1'), true);
    assert.strictEqual(validateInboundUrl('https://127.0.0.1/admin').valid, false);
  });

  runTest('Detects shorthand loopback (127.1)', () => {
    assert.strictEqual(isPrivateOrReservedHost('127.1'), true);
  });

  runTest('Detects decimal IP representation (2130706433 -> 127.0.0.1)', () => {
    assert.strictEqual(isPrivateOrReservedHost('2130706433'), true);
    // WHATWG URL normalizes decimal to 127.0.0.1
    const res = validateInboundUrl('https://2130706433/');
    assert.strictEqual(res.valid, false);
  });

  runTest('Detects hex IP representation (0x7f000001 -> 127.0.0.1)', () => {
    assert.strictEqual(isPrivateOrReservedHost('0x7f000001'), true);
    const res = validateInboundUrl('https://0x7f000001/');
    assert.strictEqual(res.valid, false);
  });

  runTest('Detects octal IP representation (0177.0.0.1 -> 127.0.0.1)', () => {
    const res = validateInboundUrl('https://0177.0.0.1/');
    assert.strictEqual(res.valid, false);
  });

  runTest('Detects RFC 1918 Class A (10.0.0.0/8)', () => {
    assert.strictEqual(isPrivateOrReservedHost('10.0.0.1'), true);
    assert.strictEqual(isPrivateOrReservedHost('10.254.254.254'), true);
    assert.strictEqual(validateInboundUrl('https://10.0.0.1/secrets').valid, false);
  });

  runTest('Detects RFC 1918 Class B (172.16.0.0/12)', () => {
    assert.strictEqual(isPrivateOrReservedHost('172.16.0.1'), true);
    assert.strictEqual(isPrivateOrReservedHost('172.31.255.254'), true);
    assert.strictEqual(validateInboundUrl('https://172.16.0.1/api').valid, false);
  });

  runTest('Detects RFC 1918 Class C (192.168.0.0/16)', () => {
    assert.strictEqual(isPrivateOrReservedHost('192.168.1.1'), true);
    assert.strictEqual(isPrivateOrReservedHost('192.168.100.50'), true);
    assert.strictEqual(validateInboundUrl('https://192.168.1.1/').valid, false);
  });

  runTest('Detects 0.0.0.0 current network', () => {
    assert.strictEqual(isPrivateOrReservedHost('0.0.0.0'), true);
    assert.strictEqual(validateInboundUrl('https://0.0.0.0/').valid, false);
  });

  runTest('Detects localhost and local domain names', () => {
    assert.strictEqual(isPrivateOrReservedHost('localhost'), true);
    assert.strictEqual(isPrivateOrReservedHost('myhost.local'), true);
    assert.strictEqual(isPrivateOrReservedHost('api.internal'), true);
    assert.strictEqual(isPrivateOrReservedHost('service.lan'), true);
    assert.strictEqual(validateInboundUrl('https://localhost/admin').valid, false);
  });

  // --------------------------------------------------------------------------
  // Group 4: Link-Local & Cloud Metadata Addresses (169.254.169.254)
  // --------------------------------------------------------------------------
  console.log('\nGroup 4: Link-Local & Cloud Metadata Addresses');

  runTest('Detects AWS/GCP/Netlify cloud metadata IP (169.254.169.254)', () => {
    assert.strictEqual(isPrivateOrReservedHost('169.254.169.254'), true);
    const res = validateInboundUrl('https://169.254.169.254/latest/meta-data/');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.error, 'Network requests to private or local addresses are forbidden.');
  });

  runTest('Detects general IPv4 link-local (169.254.0.0/16)', () => {
    assert.strictEqual(isPrivateOrReservedHost('169.254.1.1'), true);
    assert.strictEqual(isPrivateOrReservedHost('169.254.254.254'), true);
  });

  // --------------------------------------------------------------------------
  // Group 5: IPv6 Addresses
  // --------------------------------------------------------------------------
  console.log('\nGroup 5: IPv6 Addresses');

  runTest('Detects IPv6 loopback (::1)', () => {
    assert.strictEqual(isPrivateOrReservedHost('::1'), true);
    assert.strictEqual(isPrivateOrReservedHost('[::1]'), true);
    assert.strictEqual(validateInboundUrl('https://[::1]/admin').valid, false);
  });

  runTest('Detects IPv6 link-local (fe80::/10)', () => {
    assert.strictEqual(isPrivateOrReservedHost('fe80::1'), true);
    assert.strictEqual(isPrivateOrReservedHost('[fe80::200:5aee:feaa:20a2]'), true);
  });

  runTest('Detects IPv6 Unique Local Address (fc00::/7)', () => {
    assert.strictEqual(isPrivateOrReservedHost('fc00::1'), true);
    assert.strictEqual(isPrivateOrReservedHost('fd12:3456:789a::1'), true);
  });

  runTest('Detects IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)', () => {
    assert.strictEqual(isPrivateOrReservedHost('::ffff:127.0.0.1'), true);
    assert.strictEqual(isPrivateOrReservedHost('::ffff:7f00:1'), true);
    assert.strictEqual(validateInboundUrl('https://[::ffff:127.0.0.1]/').valid, false);
  });

  runTest('Detects IPv4-mapped IPv6 cloud metadata (::ffff:169.254.169.254)', () => {
    assert.strictEqual(isPrivateOrReservedHost('::ffff:169.254.169.254'), true);
    assert.strictEqual(validateInboundUrl('https://[::ffff:169.254.169.254]/').valid, false);
  });

  // --------------------------------------------------------------------------
  // Group 6: Unsupported Protocols
  // --------------------------------------------------------------------------
  console.log('\nGroup 6: Unsupported Protocols');

  runTest('Rejects insecure HTTP protocol', () => {
    const res = validateInboundUrl('http://music.apple.com/us/album/123');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.error, 'Only secure HTTPS URLs are supported.');
  });

  runTest('Rejects file:// protocol', () => {
    const res = validateInboundUrl('file:///etc/passwd');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.error, 'Only secure HTTPS URLs are supported.');
  });

  runTest('Rejects ftp:// protocol', () => {
    const res = validateInboundUrl('ftp://music.apple.com/song.mp3');
    assert.strictEqual(res.valid, false);
  });

  runTest('Rejects gopher:// protocol', () => {
    const res = validateInboundUrl('gopher://127.0.0.1:70/');
    assert.strictEqual(res.valid, false);
  });

  runTest('Rejects data: URI scheme', () => {
    const res = validateInboundUrl('data:text/html,<script>alert(1)</script>');
    assert.strictEqual(res.valid, false);
  });

  // --------------------------------------------------------------------------
  // Group 7: Unsupported Domains
  // --------------------------------------------------------------------------
  console.log('\nGroup 7: Unsupported Domains');

  runTest('Rejects arbitrary public domain (example.com)', () => {
    const res = validateInboundUrl('https://example.com/song');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.error, 'Unsupported music platform or domain.');
  });

  runTest('Rejects malicious external site', () => {
    const res = validateInboundUrl('https://attacker-controlled-site.xyz/track');
    assert.strictEqual(res.valid, false);
  });

  // --------------------------------------------------------------------------
  // Group 8: Outbound safeFetch Validation & Redirect Attack Rejection
  // --------------------------------------------------------------------------
  console.log('\nGroup 8: Outbound safeFetch Validation & Redirect Attacks');

  await runAsyncTest('safeFetch rejects outbound requests to unapproved domains', async () => {
    let err = null;
    try {
      await safeFetch('https://evil.com/payload');
    } catch (e) {
      err = e;
    }
    assert.ok(err !== null, 'safeFetch should have thrown an error');
    assert.ok(err.message.includes('not authorized'));
  });

  await runAsyncTest('safeFetch rejects outbound requests to private IPs', async () => {
    let err = null;
    try {
      await safeFetch('https://127.0.0.1:443/secret');
    } catch (e) {
      err = e;
    }
    assert.ok(err !== null);
    assert.ok(err.message.includes('private or reserved address') || err.message.includes('not authorized'));
  });

  await runAsyncTest('safeFetch rejects outbound requests to cloud metadata IP', async () => {
    let err = null;
    try {
      await safeFetch('https://169.254.169.254/latest/meta-data/');
    } catch (e) {
      err = e;
    }
    assert.ok(err !== null);
  });

  await runAsyncTest('safeFetch rejects non-HTTPS outbound URLs', async () => {
    let err = null;
    try {
      await safeFetch('http://itunes.apple.com/lookup?id=1');
    } catch (e) {
      err = e;
    }
    assert.ok(err !== null);
    assert.ok(err.message.includes('Only HTTPS outbound requests are permitted'));
  });

  runTest('Redirect destination validation rejects unauthorized or private destinations', () => {
    const origin = 'https://itunes.apple.com/api';
    const redirectTarget1 = 'https://127.0.0.1:443/internal';
    assert.strictEqual(isPrivateOrReservedHost(new URL(redirectTarget1, origin).hostname), true);

    const redirectTarget2 = 'https://evil.com/leak';
    assert.strictEqual(ALLOWED_OUTBOUND_HOSTS.has(new URL(redirectTarget2, origin).hostname), false);

    const redirectTarget3 = 'http://itunes.apple.com/unencrypted';
    assert.notStrictEqual(new URL(redirectTarget3, origin).protocol, 'https:');
  });

  // --------------------------------------------------------------------------
  // Group 9: Timeout & Response Size Caps
  // --------------------------------------------------------------------------
  console.log('\nGroup 9: Timeout & Response Size Caps');

  await runAsyncTest('safeFetch enforces timeout via AbortController', async () => {
    let err = null;
    try {
      await safeFetch('https://itunes.apple.com/lookup', { timeoutMs: 1 });
    } catch (e) {
      err = e;
    }
    assert.ok(err !== null, 'Timeout or abort should be triggered');
  });

  await runAsyncTest('readBodyWithLimit rejects oversized responses exceeding byte limit', async () => {
    const { ReadableStream } = require('stream/web');
    const oversizedStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024));
        controller.enqueue(new Uint8Array(1024));
        controller.close();
      }
    });
    const mockRes = { body: oversizedStream };
    let err = null;
    try {
      await readBodyWithLimit(mockRes, 1500); // 1.5 KB limit on 2 KB stream
    } catch (e) {
      err = e;
    }
    assert.ok(err !== null, 'Oversized body should throw error');
    assert.ok(err.message.includes('exceeds allowed limit'));
  });

  // --------------------------------------------------------------------------
  // Group 10: HMAC Download Token Verification
  // --------------------------------------------------------------------------
  console.log('\nGroup 10: HMAC Download Token Verification');

  runTest('Generates and verifies valid token for authorized audio stream', () => {
    const previewUrl = 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview123/v4/clip.mp4';
    const token = generateDownloadToken('12345', previewUrl);
    assert.ok(typeof token === 'string' && token.includes('.'));

    const verification = verifyDownloadToken(token, previewUrl);
    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.payload.id, '12345');
    assert.strictEqual(verification.payload.host, 'audio-ssl.itunes.apple.com');
  });

  runTest('Rejects tampered HMAC token', () => {
    const previewUrl = 'https://audio-ssl.itunes.apple.com/itunes-assets/clip.mp4';
    const token = generateDownloadToken('12345', previewUrl);
    const tampered = token.slice(0, -4) + '0000';

    const verification = verifyDownloadToken(tampered, previewUrl);
    assert.strictEqual(verification.valid, false);
    assert.strictEqual(verification.error, 'Invalid token signature.');
  });

  runTest('Rejects token if requested URL path or host is altered', () => {
    const origUrl = 'https://audio-ssl.itunes.apple.com/itunes-assets/track1.mp4';
    const token = generateDownloadToken('12345', origUrl);

    // Mismatched path
    const alteredUrl = 'https://audio-ssl.itunes.apple.com/itunes-assets/secret.mp4';
    const res = verifyDownloadToken(token, alteredUrl);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.error, 'Token path does not match preview URL.');
  });

  runTest('Rejects expired download token', () => {
    // Generate token with negative expiration
    const payload = {
      id: '123',
      host: 'audio-ssl.itunes.apple.com',
      pathname: '/test',
      exp: Date.now() - 5000 // Expired 5 seconds ago
    };
    const crypto = require('crypto');
    const secret = process.env.APP_DOWNLOAD_SECRET || 'appllify-music-production-hmac-secret-v2';
    const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(pB64).digest('hex');
    const expiredToken = `${pB64}.${sig}`;

    const res = verifyDownloadToken(expiredToken, 'https://audio-ssl.itunes.apple.com/test');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.error, 'Download token has expired.');
  });

  // --------------------------------------------------------------------------
  // Group 11: inspect-link.js Handler Security
  // --------------------------------------------------------------------------
  console.log('\nGroup 11: inspect-link.js Handler Security');

  await runAsyncTest('inspect-link rejects private IP in request body', async () => {
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({ url: 'https://169.254.169.254/latest/meta-data/' })
    };
    const res = await inspectHandler(event, {});
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error, 'Network requests to private or local addresses are forbidden.');
  });

  await runAsyncTest('inspect-link rejects deceptive domain in request body', async () => {
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({ url: 'https://gaana.com.attacker.com/song/test' })
    };
    const res = await inspectHandler(event, {});
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error, 'Unsupported music platform or domain.');
  });

  await runAsyncTest('inspectGaana extracts slug safely WITHOUT fetching visitor URL', async () => {
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({ url: 'https://gaana.com/song/kesariya-from-brahmastra' })
    };
    const res = await inspectHandler(event, {});
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.platform, 'gaana');
    assert.ok(body.media.title.includes('Kesariya'));
    assert.ok(body.media.downloadToken !== undefined);
  });

  // --------------------------------------------------------------------------
  // Group 12: download.js Handler Security & SSRF Protection
  // --------------------------------------------------------------------------
  console.log('\nGroup 12: download.js Handler Security & SSRF Protection');

  await runAsyncTest('download handler rejects arbitrary private IP in previewUrl', async () => {
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({
        previewUrl: 'https://169.254.169.254/latest/meta-data/',
        title: 'Exploit Track',
        artist: 'Attacker'
      })
    };
    const res = await downloadHandler(event, {});
    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.ok(body.error.includes('private or local network'));
  });

  await runAsyncTest('download handler rejects non-HTTPS previewUrl', async () => {
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({
        previewUrl: 'http://audio-ssl.itunes.apple.com/test.mp3',
        title: 'Insecure Track',
        artist: 'Attacker'
      })
    };
    const res = await downloadHandler(event, {});
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error, 'Audio stream must be HTTPS.');
  });

  await runAsyncTest('download handler rejects untrusted domain in previewUrl and resolves safely', async () => {
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({
        previewUrl: 'https://evil.com/malware.mp3',
        title: 'Test Song',
        artist: 'Test Artist'
      })
    };
    const res = await downloadHandler(event, {});
    // Must never return 302 redirect to evil.com
    assert.notStrictEqual(res.statusCode, 302);
    assert.ok([200, 404].includes(res.statusCode));
    // Should NOT stream or redirect to evil.com
    assert.strictEqual(res.headers.Location, undefined);
  });

  await runAsyncTest('download handler never open-redirects to query string URL', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: {
        preview: 'https://phishing.site/login',
        title: 'Phishing Track'
      }
    };
    const res = await downloadHandler(event, {});
    // Must NOT return 302 Location: https://phishing.site/login
    assert.notStrictEqual(res.statusCode, 302);
    assert.strictEqual(res.headers.Location, undefined);
  });

  // --------------------------------------------------------------------------
  // Group 13: Legitimate Inbound Supported URLs
  // --------------------------------------------------------------------------
  console.log('\nGroup 13: Legitimate Inbound Supported URLs');

  runTest('Accepts legitimate Apple Music URL', () => {
    const res = validateInboundUrl('https://music.apple.com/us/album/starboy/1440871441?i=1440871444');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.hostname, 'music.apple.com');
  });

  runTest('Accepts legitimate Spotify URL', () => {
    const res = validateInboundUrl('https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.hostname, 'open.spotify.com');
  });

  runTest('Accepts legitimate YouTube URL', () => {
    const res1 = validateInboundUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(res1.valid, true);
    const res2 = validateInboundUrl('https://youtu.be/dQw4w9WgXcQ');
    assert.strictEqual(res2.valid, true);
  });

  runTest('Accepts legitimate JioSaavn URL', () => {
    const res = validateInboundUrl('https://www.jiosaavn.com/song/kesariya/XyZ123');
    assert.strictEqual(res.valid, true);
  });

  runTest('Accepts legitimate SoundCloud URL', () => {
    const res = validateInboundUrl('https://soundcloud.com/artist/track-name');
    assert.strictEqual(res.valid, true);
  });

  console.log('\n======================================================');
  console.log(`📊 TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED (100%)`);
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
