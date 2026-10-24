// Netlify Serverless Function: /api/inspect-link
// Secure SSRF-hardened media inspector with WHATWG URL validation and safe network fetching

const {
  validateInboundUrl,
  safeFetch,
  generateDownloadToken
} = require('./utils/security');

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = Number(bytes);
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function detectPlatform(hostname) {
  if (hostname === 'music.apple.com') return 'apple_music';
  if (hostname === 'open.spotify.com' || hostname === 'spotify.com') return 'spotify';
  if (hostname === 'jiosaavn.com' || hostname === 'www.jiosaavn.com') return 'jiosaavn';
  if (hostname === 'gaana.com' || hostname === 'www.gaana.com') return 'gaana';
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(hostname)) return 'youtube';
  if (['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(hostname)) return 'soundcloud';
  return null;
}

// 1. Apple Music via iTunes Search API
async function inspectAppleMusic(parsedUrl) {
  const urlStr = parsedUrl.toString();
  const songParam = parsedUrl.searchParams.get('i');
  const albumMatch = parsedUrl.pathname.match(/album\/(?:[^/]+\/)?([0-9]+)/);
  const rawId = songParam || (albumMatch ? albumMatch[1] : null);

  if (!rawId || !/^[0-9]+$/.test(rawId)) {
    throw new Error('Valid Apple Music song or album ID not found.');
  }

  const countryMatch = parsedUrl.pathname.match(/^\/([a-z]{2})\//i);
  const country = countryMatch ? countryMatch[1].toLowerCase() : 'us';

  const itunesUrl = `https://itunes.apple.com/lookup?id=${encodeURIComponent(rawId)}&country=${encodeURIComponent(country)}&entity=song`;
  const res = await safeFetch(itunesUrl, {
    headers: { 'Accept': 'application/json' },
    maxBytes: 1024 * 1024
  });

  if (!res.ok) {
    throw new Error('Apple Music lookup failed.');
  }

  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error('Media not found on Apple Music.');
  }

  const isSongExplicit = Boolean(songParam);
  const collection = data.results.find(r => r.wrapperType === 'collection');
  const first = data.results[0];
  const isAlbum = Boolean(collection && !isSongExplicit);

  if (isAlbum) {
    const parentCollection = collection || first;
    const rawTracks = data.results.filter(r => r.wrapperType === 'track');
    const artwork = (parentCollection.artworkUrl100 || first.artworkUrl100 || '').replace('100x100bb.jpg', '3000x3000bb.jpg');

    let totalDurationMs = 0;
    const tracks = rawTracks.map((t, idx) => {
      const durMs = t.trackTimeMillis || 210000;
      totalDurationMs += durMs;
      const tEstBytes = Math.round((durMs / 1000) * 40 * 1024);
      const trackId = String(t.trackId || idx + 1);
      const previewUrl = t.previewUrl || null;
      return {
        id: trackId,
        trackNumber: t.trackNumber || idx + 1,
        title: t.trackName || `Track ${idx + 1}`,
        artist: t.artistName || parentCollection.artistName,
        album: parentCollection.collectionName,
        artwork: artwork,
        durationMs: durMs,
        durationString: formatTime(durMs / 1000),
        sizeFormatted: `~${formatBytes(tEstBytes)}`,
        previewUrl: previewUrl,
        downloadToken: generateDownloadToken(trackId, previewUrl),
        url: t.trackViewUrl || urlStr,
        searchQuery: `${t.artistName || parentCollection.artistName} - ${t.trackName} audio`
      };
    });

    const totalEstBytes = Math.round((totalDurationMs / 1000) * 40 * 1024);
    const sizeStr = `~${formatBytes(totalEstBytes)}`;
    const albumId = String(parentCollection.collectionId || rawId);
    const firstPreview = first.previewUrl || null;

    return {
      platform: 'apple_music',
      platformName: 'Apple Music',
      platformIcon: '🍎',
      type: 'album',
      id: albumId,
      title: parentCollection.collectionName,
      artist: parentCollection.artistName,
      artwork: artwork,
      genre: parentCollection.primaryGenreName || 'Music',
      year: parentCollection.releaseDate ? new Date(parentCollection.releaseDate).getFullYear() : '2024',
      tracks: tracks.length > 0 ? tracks : [{
        id: albumId,
        trackNumber: 1,
        title: parentCollection.collectionName,
        artist: parentCollection.artistName,
        album: parentCollection.collectionName,
        artwork: artwork,
        durationMs: 210000,
        durationString: '3:30',
        sizeFormatted: '~7 MB',
        previewUrl: firstPreview,
        downloadToken: generateDownloadToken(albumId, firstPreview),
        url: urlStr,
        searchQuery: `${parentCollection.artistName} - ${parentCollection.collectionName} audio`
      }],
      totalTracks: tracks.length || 1,
      totalDurationMs: totalDurationMs || 210000,
      totalSizeFormatted: sizeStr,
      url: urlStr,
      mediaFormats: ['mp3', 'alac', 'flac']
    };
  } else {
    // Single track
    const track = data.results.find(r => r.wrapperType === 'track') || first;
    const durMs = track.trackTimeMillis || 210000;
    const estBytes = Math.round((durMs / 1000) * 40 * 1024);
    const artwork = (track.artworkUrl100 || '').replace('100x100bb.jpg', '3000x3000bb.jpg');
    const sizeStr = `~${formatBytes(estBytes)}`;
    const trackId = String(track.trackId || rawId);
    const previewUrl = track.previewUrl || null;

    return {
      platform: 'apple_music',
      platformName: 'Apple Music',
      platformIcon: '🍎',
      type: 'track',
      id: trackId,
      title: track.trackName || track.collectionName,
      artist: track.artistName,
      album: track.collectionName || track.trackName,
      artwork: artwork,
      durationMs: durMs,
      durationString: formatTime(durMs / 1000),
      sizeFormatted: sizeStr,
      estimatedSizes: { mp3: sizeStr, flac: `~${formatBytes(estBytes * 3)}` },
      previewUrl: previewUrl,
      downloadToken: generateDownloadToken(trackId, previewUrl),
      url: track.trackViewUrl || urlStr,
      searchQuery: `${track.artistName} - ${track.trackName} audio`,
      mediaFormats: ['mp3', 'alac', 'flac']
    };
  }
}

// 2. JioSaavn Inspection (Search API)
async function inspectJioSaavn(parsedUrl) {
  const urlStr = parsedUrl.toString();
  const slugMatch = parsedUrl.pathname.match(/(?:song|album)\/([a-zA-Z0-9-_]+)/i);
  const rawSlug = slugMatch ? slugMatch[1].replace(/[-_]/g, ' ').replace(/[^a-zA-Z0-9 ]/g, '').trim() : '';

  try {
    const query = (rawSlug || 'Song').slice(0, 80);
    const saavnApi = `https://www.jiosaavn.com/api.php?__call=search.getResults&q=${encodeURIComponent(query)}&_format=json&_marker=0&ctx=web6dot0`;
    const sRes = await safeFetch(saavnApi, { maxBytes: 512 * 1024 });

    if (sRes.ok) {
      const sData = await sRes.json();
      if (sData.results && sData.results.length > 0) {
        const item = sData.results[0];
        const artwork = (item.image || '').replace('150x150', '500x500');
        const durSec = parseInt(item.duration, 10) || 240;
        const trackId = String(item.id || `jiosaavn_${Date.now()}`);
        return {
          platform: 'jiosaavn',
          platformName: 'JioSaavn',
          platformIcon: '🟢',
          type: 'track',
          id: trackId,
          title: item.song || rawSlug || 'JioSaavn Track',
          artist: item.primary_artists || item.singers || 'JioSaavn Artist',
          album: item.album || item.song || 'JioSaavn',
          artwork: artwork || 'https://appllifymusic.netlify.app/og-banner.png',
          durationMs: durSec * 1000,
          durationString: formatTime(durSec),
          url: urlStr,
          previewUrl: null, // Audio fetched safely via iTunes search CDN
          downloadToken: generateDownloadToken(trackId, null),
          searchQuery: `${item.primary_artists || ''} - ${item.song || rawSlug} audio`,
          mediaFormats: ['mp3'],
          sizeFormatted: '~9.6 MB',
          estimatedSizes: { mp3: '~9.6 MB' }
        };
      }
    }
  } catch (err) {
    console.warn('JioSaavn API search failed, using sanitized fallback');
  }

  const title = rawSlug ? rawSlug.replace(/\b\w/g, l => l.toUpperCase()) : 'JioSaavn Track';
  const trackId = `jiosaavn_${Date.now()}`;
  return {
    platform: 'jiosaavn',
    platformName: 'JioSaavn',
    platformIcon: '🟢',
    type: 'track',
    id: trackId,
    title: title,
    artist: 'JioSaavn Artist',
    album: title,
    artwork: 'https://appllifymusic.netlify.app/og-banner.png',
    durationMs: 240000,
    durationString: '4:00',
    url: urlStr,
    previewUrl: null,
    downloadToken: generateDownloadToken(trackId, null),
    searchQuery: `${title} audio`,
    mediaFormats: ['mp3'],
    sizeFormatted: '~9.6 MB',
    estimatedSizes: { mp3: '~9.6 MB' }
  };
}

// 3. Spotify Inspection via Spotify oEmbed
async function inspectSpotify(parsedUrl) {
  const urlStr = parsedUrl.toString();
  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(urlStr)}`;
  const res = await safeFetch(oembedUrl, { maxBytes: 512 * 1024 });

  if (!res.ok) {
    throw new Error('Spotify metadata lookup failed.');
  }

  const data = await res.json();
  const isPlaylist = /playlist|album/i.test(parsedUrl.pathname);
  const title = data.title || 'Spotify Media';
  const artist = data.author_name || (isPlaylist ? 'Curated Playlist' : 'Spotify Artist');
  const artwork = data.thumbnail_url || 'https://appllifymusic.netlify.app/og-banner.png';
  const trackId = `spotify_${Date.now()}`;

  return {
    platform: 'spotify',
    platformName: 'Spotify',
    platformIcon: '🟢',
    type: isPlaylist ? 'playlist' : 'track',
    id: trackId,
    title: title,
    artist: artist,
    album: title,
    artwork: artwork,
    durationMs: 210000,
    durationString: '3:30',
    url: urlStr,
    previewUrl: null,
    downloadToken: generateDownloadToken(trackId, null),
    searchQuery: `${artist} - ${title} audio`,
    mediaFormats: ['mp3'],
    sizeFormatted: '~8.4 MB',
    estimatedSizes: { mp3: '~8.4 MB' }
  };
}

// 4. Gaana Inspection - Strictly extracts metadata without fetching arbitrary visitor URL!
async function inspectGaana(parsedUrl) {
  const urlStr = parsedUrl.toString();
  // Strictly parse slug from pathname only - NO outbound fetch to user-supplied Gaana URL
  const slugMatch = parsedUrl.pathname.match(/(?:song|album)\/([a-zA-Z0-9-_]+)/i);
  const rawSlug = slugMatch ? slugMatch[1].replace(/[-_]/g, ' ').replace(/[^a-zA-Z0-9 ]/g, '').trim() : '';
  const title = rawSlug ? rawSlug.replace(/\b\w/g, l => l.toUpperCase()) : 'Gaana Track';

  // Safely resolve metadata using official iTunes Search API CDN via safeFetch
  let resolvedPreview = null;
  let artist = 'Gaana Artist';
  let artwork = 'https://appllifymusic.netlify.app/og-banner.png';

  if (rawSlug) {
    try {
      const itunesApi = `https://itunes.apple.com/search?term=${encodeURIComponent(rawSlug.slice(0, 80))}&entity=song&limit=1`;
      const iRes = await safeFetch(itunesApi, { maxBytes: 512 * 1024 });
      if (iRes.ok) {
        const iData = await iRes.json();
        if (iData.results && iData.results.length > 0) {
          const first = iData.results[0];
          if (first.artistName) artist = first.artistName;
          if (first.artworkUrl100) artwork = first.artworkUrl100.replace('100x100bb.jpg', '500x500bb.jpg');
          if (first.previewUrl) resolvedPreview = first.previewUrl;
        }
      }
    } catch (e) {
      // Graceful fallback to formatted slug metadata
    }
  }

  const isPlaylist = /playlist|album/i.test(parsedUrl.pathname);
  const trackId = `gaana_${Date.now()}`;

  return {
    platform: 'gaana',
    platformName: 'Gaana',
    platformIcon: '🔴',
    type: isPlaylist ? 'playlist' : 'track',
    id: trackId,
    title: title,
    artist: artist,
    album: title,
    artwork: artwork,
    durationMs: 210000,
    durationString: '3:30',
    url: urlStr,
    previewUrl: resolvedPreview,
    downloadToken: generateDownloadToken(trackId, resolvedPreview),
    searchQuery: `${artist} - ${title} audio`,
    mediaFormats: ['mp3'],
    sizeFormatted: '~8.4 MB',
    estimatedSizes: { mp3: '~8.4 MB' }
  };
}

// 5. YouTube via oEmbed
async function inspectYouTube(parsedUrl) {
  const urlStr = parsedUrl.toString();
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(urlStr)}&format=json`;
  const res = await safeFetch(oembedUrl, { maxBytes: 512 * 1024 });

  if (!res.ok) {
    throw new Error('YouTube video not found or private.');
  }

  const data = await res.json();
  const trackId = `yt_${Date.now()}`;

  return {
    platform: 'youtube',
    platformName: 'YouTube',
    platformIcon: '🔴',
    type: 'video',
    id: trackId,
    title: data.title || 'YouTube Video',
    artist: data.author_name || 'YouTube Creator',
    album: 'YouTube',
    artwork: data.thumbnail_url || 'https://appllifymusic.netlify.app/og-banner.png',
    durationMs: 240000,
    durationString: '4:00',
    url: urlStr,
    previewUrl: null,
    downloadToken: generateDownloadToken(trackId, null),
    searchQuery: `${data.author_name} - ${data.title} audio`,
    mediaFormats: ['mp3', 'mp4'],
    sizeFormatted: '~9.6 MB',
    estimatedSizes: { mp3: '~9.6 MB', mp4: '~28.4 MB' }
  };
}

// 6. SoundCloud via oEmbed
async function inspectSoundCloud(parsedUrl) {
  const urlStr = parsedUrl.toString();
  const oembedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(urlStr)}&format=json`;
  const res = await safeFetch(oembedUrl, { maxBytes: 512 * 1024 });

  if (!res.ok) {
    throw new Error('SoundCloud track could not be loaded.');
  }

  const data = await res.json();
  const trackId = `sc_${Date.now()}`;

  return {
    platform: 'soundcloud',
    platformName: 'SoundCloud',
    platformIcon: '🟠',
    type: 'track',
    id: trackId,
    title: data.title || 'SoundCloud Track',
    artist: data.author_name || 'SoundCloud Artist',
    album: 'SoundCloud',
    artwork: data.thumbnail_url || 'https://appllifymusic.netlify.app/og-banner.png',
    durationMs: 200000,
    durationString: '3:20',
    url: urlStr,
    previewUrl: null,
    downloadToken: generateDownloadToken(trackId, null),
    searchQuery: `${data.author_name} - ${data.title} audio`,
    mediaFormats: ['mp3'],
    sizeFormatted: '~8.0 MB',
    estimatedSizes: { mp3: '~8.0 MB' }
  };
}

// Netlify Function Handler
exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    let rawUrl = '';
    if (event.httpMethod === 'POST' && event.body) {
      try {
        const parsedBody = JSON.parse(event.body);
        rawUrl = parsedBody.url;
      } catch (e) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid JSON request body.' })
        };
      }
    } else if (event.queryStringParameters && event.queryStringParameters.url) {
      rawUrl = event.queryStringParameters.url;
    }

    // Strict URL parsing & allowlist validation
    const validation = validateInboundUrl(rawUrl);
    if (!validation.valid) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: validation.error })
      };
    }

    const { parsedUrl, hostname } = validation;
    const platform = detectPlatform(hostname);

    if (!platform) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Unsupported music platform.' })
      };
    }

    let media = null;
    if (platform === 'apple_music') {
      media = await inspectAppleMusic(parsedUrl);
    } else if (platform === 'jiosaavn') {
      media = await inspectJioSaavn(parsedUrl);
    } else if (platform === 'spotify') {
      media = await inspectSpotify(parsedUrl);
    } else if (platform === 'gaana') {
      media = await inspectGaana(parsedUrl);
    } else if (platform === 'youtube') {
      media = await inspectYouTube(parsedUrl);
    } else if (platform === 'soundcloud') {
      media = await inspectSoundCloud(parsedUrl);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        platform: media.platform,
        media: media
      })
    };
  } catch (err) {
    // Sanitize error response: never expose internal network details, system paths, or stack traces
    console.error('Inspection error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Unable to inspect the requested link at this time.'
      })
    };
  }
};
