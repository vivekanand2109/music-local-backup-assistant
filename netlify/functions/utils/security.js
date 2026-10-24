// Netlify Functions Security & SSRF Protection Utility
// Implements strict WHATWG URL validation, private IP blocking, safe fetch with redirect controls,
// AbortController timeouts, response-size caps, and HMAC token signing/verification.

const crypto = require('crypto');
const net = require('net');

// 1. Explicit Domain Allowlists
const ALLOWED_INBOUND_HOSTS = new Set([
  'music.apple.com',
  'open.spotify.com',
  'spotify.com',
  'jiosaavn.com',
  'www.jiosaavn.com',
  'gaana.com',
  'www.gaana.com',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com'
]);

const ALLOWED_OUTBOUND_HOSTS = new Set([
  'itunes.apple.com',
  'audio-ssl.itunes.apple.com',
  'open.spotify.com',
  'www.jiosaavn.com',
  'www.youtube.com',
  'soundcloud.com'
]);

const ALLOWED_AUDIO_HOSTS = new Set([
  'audio-ssl.itunes.apple.com'
]);

// Secret for HMAC download tokens
const DOWNLOAD_SECRET = process.env.APP_DOWNLOAD_SECRET || 'appllify-music-production-hmac-secret-v2';

/**
 * Checks whether an IPv4 address is in a private, loopback, link-local, or reserved range.
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IP, treat as unsafe
  }
  const [a, b, c, d] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 169.254.0.0/16 (Link-Local, AWS/Cloud Metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;
  // 192.88.99.0/24 (6to4 Relay Anycast)
  if (a === 192 && b === 88 && c === 99) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (Network Benchmark Tests)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 (Reserved)
  if (a >= 240) return true;
  // 255.255.255.255 (Broadcast)
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;

  return false;
}

/**
 * Checks whether an IPv6 address is in a private, loopback, link-local, or reserved range.
 */
function isPrivateIPv6(ip) {
  let cleanIp = ip.toLowerCase();
  if (cleanIp.startsWith('[') && cleanIp.endsWith(']')) {
    cleanIp = cleanIp.slice(1, -1);
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (cleanIp.startsWith('::ffff:')) {
    const v4Part = cleanIp.slice(7);
    if (net.isIPv4(v4Part)) {
      return isPrivateIPv4(v4Part);
    }
    // Hex notation e.g. 7f00:1
    const hexParts = v4Part.split(':');
    if (hexParts.length === 2) {
      const p1 = parseInt(hexParts[0], 16);
      const p2 = parseInt(hexParts[1], 16);
      if (!isNaN(p1) && !isNaN(p2)) {
        const a = (p1 >> 8) & 0xff;
        const b = p1 & 0xff;
        const c = (p2 >> 8) & 0xff;
        const d = p2 & 0xff;
        return isPrivateIPv4(`${a}.${b}.${c}.${d}`);
      }
    }
    return true; // Treat unrecognized mapped as private
  }

  // Unspecified & Loopback
  if (cleanIp === '::' || cleanIp === '::1') return true;

  // Unique Local Address (fc00::/7)
  if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return true;

  // Link-Local Unicast (fe80::/10)
  if (/^fe[89ab]/i.test(cleanIp)) return true;

  // Multicast (ff00::/8)
  if (cleanIp.startsWith('ff')) return true;

  // Documentation (2001:db8::/32)
  if (cleanIp.startsWith('2001:db8') || cleanIp.startsWith('2001:0db8')) return true;

  return false;
}

/**
 * Determines whether a given hostname is a private/loopback/link-local/reserved host or IP.
 */
function isPrivateOrReservedHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return true;
  let host = hostname.toLowerCase().trim();

  // Strip enclosing brackets for IPv6 if present
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  // Localhost names
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) {
    return true;
  }

  // Normalize shorthand IPs (e.g. 127.1 -> 127.0.0.1, hex/octal/decimal) using WHATWG parser
  try {
    const dummy = new URL(`https://${host}`);
    if (dummy.hostname) {
      host = dummy.hostname.toLowerCase();
      if (host.startsWith('[') && host.endsWith(']')) {
        host = host.slice(1, -1);
      }
    }
  } catch (e) {}

  // Check IPv4
  const ipType = net.isIP(host);
  if (ipType === 4) {
    return isPrivateIPv4(host);
  }
  // Check IPv6
  if (ipType === 6) {
    return isPrivateIPv6(host);
  }

  // Reject decimal / octal integer hostnames e.g. 2130706433 or 0x7f000001
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return true;
  }

  return false;
}

/**
 * Validates user-submitted URL strictly using WHATWG URL constructor inside try/catch.
 * Accepts only HTTPS and explicitly allowed platform hosts.
 */
function validateInboundUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { valid: false, error: 'Please provide a valid music link.' };
  }

  // Reject control characters or null bytes
  if (/[\x00-\x1F\x7F]/.test(rawUrl)) {
    return { valid: false, error: 'URL contains control characters.' };
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return { valid: false, error: 'URL exceeds maximum allowable length.' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (e) {
    return { valid: false, error: 'The provided link is not a valid URL.' };
  }

  // 1. Enforce HTTPS only
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only secure HTTPS URLs are supported.' };
  }

  // 2. Enforce standard port 443
  if (parsed.port && parsed.port !== '443') {
    return { valid: false, error: 'Non-standard port numbers are not permitted.' };
  }

  // 3. Reject embedded credentials (e.g. user:pass@host)
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Embedded credentials in URLs are not permitted.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 4. Reject private, loopback, or link-local hosts
  if (isPrivateOrReservedHost(hostname)) {
    return { valid: false, error: 'Network requests to private or local addresses are forbidden.' };
  }

  // 5. Must belong to explicit allowlist
  if (!ALLOWED_INBOUND_HOSTS.has(hostname)) {
    return { valid: false, error: 'Unsupported music platform or domain.' };
  }

  return { valid: true, parsedUrl: parsed, hostname };
}

/**
 * Reads a ReadableStream body with a hard byte-size cap to prevent memory exhaustion / DoS.
 */
async function readBodyWithLimit(response, maxBytes) {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error('Response size exceeds allowed limit.');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Safe fetch wrapper that enforces:
 * - Allowed destination hosts only
 * - HTTPS protocol and standard port 443
 * - Private / loopback / link-local IP rejection
 * - Manual redirect inspection (maxRedirects)
 * - AbortController timeout
 * - Response size capping
 */
async function safeFetch(targetUrl, options = {}) {
  const {
    allowedHosts = ALLOWED_OUTBOUND_HOSTS,
    maxRedirects = 2,
    timeoutMs = 5000,
    maxBytes = 2 * 1024 * 1024, // 2MB default for API calls
    headers = {}
  } = options;

  let currentUrl = targetUrl;
  let redirectsCount = 0;

  while (redirectsCount <= maxRedirects) {
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch (e) {
      throw new Error('Invalid destination URL.');
    }

    if (parsed.protocol !== 'https:') {
      throw new Error('Only HTTPS outbound requests are permitted.');
    }

    if (parsed.port && parsed.port !== '443') {
      throw new Error('Non-standard destination ports are not permitted.');
    }

    if (parsed.username || parsed.password) {
      throw new Error('Destination credentials are not permitted.');
    }

    const hostname = parsed.hostname.toLowerCase();

    if (isPrivateOrReservedHost(hostname)) {
      throw new Error('Outbound destination resolves to a private or reserved address.');
    }

    if (!allowedHosts.has(hostname)) {
      throw new Error(`Outbound host "${hostname}" is not authorized.`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(parsed.toString(), {
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'AppllifyMusic/2.5 (+https://appllifymusic.netlify.app)',
          ...headers
        },
        redirect: 'manual', // Never auto-follow redirects!
        signal: controller.signal
      });

      // Handle redirect status codes explicitly
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (!location) {
          throw new Error('Redirect missing Location header.');
        }

        redirectsCount++;
        if (redirectsCount > maxRedirects) {
          throw new Error('Too many redirects encountered.');
        }

        // Resolve redirect relative to current URL
        currentUrl = new URL(location, parsed.toString()).toString();
        continue;
      }

      // Check Content-Length if present
      const cl = res.headers.get('content-length');
      if (cl && parseInt(cl, 10) > maxBytes) {
        throw new Error('Response size exceeds maximum allowable limit.');
      }

      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        async json() {
          const buf = await readBodyWithLimit(res, maxBytes);
          return JSON.parse(buf.toString('utf8'));
        },
        async text() {
          const buf = await readBodyWithLimit(res, maxBytes);
          return buf.toString('utf8');
        },
        async buffer() {
          return await readBodyWithLimit(res, maxBytes);
        }
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error('Maximum redirect limit exceeded.');
}

/**
 * Generates an HMAC-SHA256 signed download token for authorized audio playback/download.
 * Valid for 10 minutes.
 */
function generateDownloadToken(trackId, previewUrl) {
  let host = '';
  let pathname = '';
  if (previewUrl) {
    try {
      const u = new URL(previewUrl);
      host = u.hostname.toLowerCase();
      pathname = u.pathname;
    } catch (e) {}
  }

  const exp = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
  const payload = {
    id: String(trackId || ''),
    host,
    pathname,
    exp
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

/**
 * Verifies an HMAC-SHA256 download token.
 * Validates expiration, signature, authorized host, and resource path.
 */
function verifyDownloadToken(token, previewUrl) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing or invalid download token.' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed download token.' };
  }

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', DOWNLOAD_SECRET).update(payloadB64).digest('hex');

  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: 'Invalid token signature.' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (e) {
    return { valid: false, error: 'Invalid token payload.' };
  }

  if (Date.now() > payload.exp) {
    return { valid: false, error: 'Download token has expired.' };
  }

  if (payload.host && !ALLOWED_AUDIO_HOSTS.has(payload.host)) {
    return { valid: false, error: 'Token authorizes an untrusted host.' };
  }

  if (previewUrl) {
    let parsed;
    try {
      parsed = new URL(previewUrl);
    } catch (e) {
      return { valid: false, error: 'Invalid preview URL.' };
    }

    if (payload.host && parsed.hostname.toLowerCase() !== payload.host) {
      return { valid: false, error: 'Token host does not match preview URL.' };
    }

    if (payload.pathname && parsed.pathname !== payload.pathname) {
      return { valid: false, error: 'Token path does not match preview URL.' };
    }
  }

  return { valid: true, payload };
}

function cleanFileName(str) {
  return (str || 'Track')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

module.exports = {
  ALLOWED_INBOUND_HOSTS,
  ALLOWED_OUTBOUND_HOSTS,
  ALLOWED_AUDIO_HOSTS,
  isPrivateOrReservedHost,
  validateInboundUrl,
  safeFetch,
  readBodyWithLimit,
  generateDownloadToken,
  verifyDownloadToken,
  cleanFileName
};
