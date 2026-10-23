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
    if (previewUrl && previewUrl.startsWith('http')) {
      const audioRes = await fetch(previewUrl);
      if (audioRes.ok) {
        const buffer = await audioRes.arrayBuffer();
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'audio/mpeg',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(buffer.byteLength)
          },
          body: Buffer.from(buffer).toString('base64'),
          isBase64Encoded: true
        };
      }
    }

    // 2. JioSaavn Direct CDN resolution
    if (/jiosaavn\.com|saavn\.com/i.test(url) || platform === 'jiosaavn') {
      try {
        const pageRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          }
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const pidMatch = html.match(/"pid":"([a-zA-Z0-9_-]+)"/) || html.match(/"id":"([a-zA-Z0-9_-]+)"/);
          if (pidMatch) {
            const pid = pidMatch[1];
            const apiRes = await fetch(`https://www.jiosaavn.com/api.php?__call=song.getDetails&pids=${pid}&_format=json&_marker=0&ctx=web6dot0`);
            if (apiRes.ok) {
              const j = await apiRes.json();
              const song = j[pid];
              if (song) {
                let streamUrl = song.media_preview_url;
                if (song.encrypted_media_url) {
                  try {
                    const key = Buffer.from('38346591', 'utf-8');
                    const decipher = crypto.createDecipheriv('des-ecb', key, '');
                    let dec = decipher.update(song.encrypted_media_url, 'base64', 'utf-8');
                    dec += decipher.final('utf-8');
                    streamUrl = dec;
                  } catch (e) {}
                }

                if (streamUrl) {
                  // Redirect directly to high-speed CDN audio stream with download
                  return {
                    statusCode: 302,
                    headers: {
                      ...headers,
                      'Location': streamUrl
                    },
                    body: ''
                  };
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('JioSaavn direct download fallback:', err);
      }
    }

    // 3. Fallback: Generate an audio response or high-speed stream redirect
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Download link ready',
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
