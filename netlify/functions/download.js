// Netlify Serverless Function: /api/download & /api/download-media
// Secure audio delivery with token validation, audio-host allowlisting, and SSRF prevention

const {
  ALLOWED_AUDIO_HOSTS,
  safeFetch,
  verifyDownloadToken,
  cleanFileName,
  isPrivateOrReservedHost
} = require('./utils/security');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    let title = 'Audio Track';
    let artist = 'Appllify Music';
    let query = '';
    let previewUrl = '';
    let downloadToken = '';

    if (event.httpMethod === 'POST' && event.body) {
      try {
        const data = JSON.parse(event.body);
        const item = data.item || data.track || data;
        title = item.title || item.name || title;
        artist = item.artist || item.subtitle || artist;
        query = item.searchQuery || `${artist} - ${title}`;
        previewUrl = item.previewUrl || '';
        downloadToken = item.downloadToken || data.downloadToken || '';
      } catch (e) {
        return {
          statusCode: 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Invalid JSON request body.' })
        };
      }
    } else if (event.queryStringParameters) {
      const q = event.queryStringParameters;
      title = q.title || title;
      artist = q.artist || artist;
      query = q.q || `${artist} - ${title}`;
      previewUrl = q.preview || '';
      downloadToken = q.token || '';
    }

    const filename = `${cleanFileName(artist)} - ${cleanFileName(title)}.mp3`;

    // 1. SSRF & Host Validation on visitor-supplied previewUrl
    if (previewUrl) {
      let parsedPreview;
      try {
        parsedPreview = new URL(previewUrl);
      } catch (e) {
        return {
          statusCode: 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Malformed audio stream URL.' })
        };
      }

      // Strictly reject non-HTTPS
      if (parsedPreview.protocol !== 'https:') {
        return {
          statusCode: 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Audio stream must be HTTPS.' })
        };
      }

      // Reject non-standard ports or credentials
      if ((parsedPreview.port && parsedPreview.port !== '443') || parsedPreview.username || parsedPreview.password) {
        return {
          statusCode: 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Invalid audio URL parameters.' })
        };
      }

      const host = parsedPreview.hostname.toLowerCase();

      // Strictly reject private, loopback, link-local, and reserved IP addresses
      if (isPrivateOrReservedHost(host)) {
        return {
          statusCode: 403,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Access to private or local network resources is forbidden.' })
        };
      }

      // Verify whether the host is in authorized audio hosts
      if (!ALLOWED_AUDIO_HOSTS.has(host)) {
        // Discard untrusted third-party stream URL, reset previewUrl to resolve via official iTunes Search CDN
        previewUrl = '';
      } else if (downloadToken) {
        // If a token is provided, verify it
        const tokenCheck = verifyDownloadToken(downloadToken, previewUrl);
        if (!tokenCheck.valid) {
          // Token signature invalid or expired
          previewUrl = '';
        }
      }
    }

    // 2. Direct preview resolution via official iTunes Search API CDN if previewUrl is empty
    if (!previewUrl) {
      try {
        const sanitizedTerm = (query || `${artist} ${title}`)
          .replace(/[^a-zA-Z0-9 ]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80);

        if (sanitizedTerm) {
          const itunesApi = `https://itunes.apple.com/search?term=${encodeURIComponent(sanitizedTerm)}&entity=song&limit=1`;
          const iRes = await safeFetch(itunesApi, {
            headers: { 'Accept': 'application/json' },
            maxBytes: 512 * 1024
          });

          if (iRes.ok) {
            const iData = await iRes.json();
            if (iData.results && iData.results.length > 0) {
              const first = iData.results[0];
              if (first.previewUrl) {
                const u = new URL(first.previewUrl);
                if (ALLOWED_AUDIO_HOSTS.has(u.hostname.toLowerCase())) {
                  previewUrl = first.previewUrl;
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn('iTunes audio stream resolution failed');
      }
    }

    // 3. Fetch and stream the audio binary using safeFetch
    if (previewUrl) {
      try {
        const audioRes = await safeFetch(previewUrl, {
          allowedHosts: ALLOWED_AUDIO_HOSTS,
          maxBytes: 15 * 1024 * 1024, // 15MB limit for audio streams
          timeoutMs: 8000
        });

        if (audioRes.ok) {
          const buffer = await audioRes.buffer();
          return {
            statusCode: 200,
            headers: {
              ...headers,
              'Content-Type': 'audio/mpeg',
              'Content-Disposition': `attachment; filename="${filename}"`,
              'Content-Length': String(buffer.byteLength),
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length'
            },
            body: buffer.toString('base64'),
            isBase64Encoded: true
          };
        }
      } catch (err) {
        console.warn('Safe audio stream fetch error:', err.message);
      }
    }

    // 4. Fallback: Return structured JSON response (Never open-redirect!)
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: Boolean(previewUrl),
        title: title,
        artist: artist,
        filename: filename,
        message: previewUrl ? 'Audio stream available.' : 'Audio preview is not available for this track.'
      })
    };
  } catch (err) {
    // Sanitize error: never leak system information or stack traces
    console.error('Download handler error:', err.message);
    return {
      statusCode: 500,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: 'Unable to process download request at this time.'
      })
    };
  }
};
