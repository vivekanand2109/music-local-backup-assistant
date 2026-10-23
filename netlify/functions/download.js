// Netlify Serverless Function: /api/download & /api/download-media
// Streams or downloads audio directly to user's mobile phone or PC

const crypto = require('crypto');

function cleanFileName(str) {
  return (str || 'Track').replace(/[/\\?%*:|"<>]/g, '_').trim();
}

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
    let platform = '';
    let previewUrl = '';
    let url = '';

    if (event.httpMethod === 'POST' && event.body) {
      const data = JSON.parse(event.body);
      const item = data.item || data.track || data;
      title = item.title || item.name || title;
      artist = item.artist || item.subtitle || artist;
      query = item.searchQuery || `${artist} - ${title}`;
      platform = item.platform || '';
      previewUrl = item.previewUrl || '';
      url = item.url || data.url || '';
    } else if (event.queryStringParameters) {
      const q = event.queryStringParameters;
      title = q.title || title;
      artist = q.artist || artist;
      query = q.q || `${artist} - ${title}`;
      platform = q.platform || '';
      previewUrl = q.preview || '';
      url = q.url || '';
    }

    const filename = `${cleanFileName(artist)} - ${cleanFileName(title)}.mp3`;

    // 1. Direct preview / CDN stream if present
    if (!previewUrl || !previewUrl.startsWith('http')) {
      try {
        const searchQuery = query || `${artist} ${title}`;
        const itunesApi = `https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&entity=song&limit=1`;
        const iRes = await fetch(itunesApi, { headers: { 'Accept': 'application/json' } });
        if (iRes.ok) {
          const iData = await iRes.json();
          if (iData.results && iData.results.length > 0) {
            const first = iData.results[0];
            if (first.previewUrl) {
              previewUrl = first.previewUrl;
            }
          }
        }
      } catch (e) {
        console.warn('iTunes audio stream resolution failed:', e.message);
      }
    }

    // 2. Fetch and stream the audio binary as download attachment
    if (previewUrl && previewUrl.startsWith('http')) {
      try {
        const audioRes = await fetch(previewUrl);
        if (audioRes.ok) {
          const buffer = await audioRes.arrayBuffer();
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
            body: Buffer.from(buffer).toString('base64'),
            isBase64Encoded: true
          };
        }
      } catch (err) {
        console.warn('Direct stream fetch error:', err.message);
      }
    }

    // 3. Fallback: Provide direct stream redirect
    if (previewUrl) {
      return {
        statusCode: 302,
        headers: {
          ...headers,
          'Location': previewUrl
        },
        body: ''
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Download ready',
        title: title,
        artist: artist,
        filename: filename,
        downloadUrl: previewUrl || url
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
