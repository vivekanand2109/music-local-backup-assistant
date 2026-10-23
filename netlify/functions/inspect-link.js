// Netlify Serverless Function: /api/inspect-link
// 100% Standalone - No external backend or ngrok needed!

const crypto = require('crypto');

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

function detectPlatform(rawUrl) {
  const url = (rawUrl || '').trim();
  if (/music\.apple\.com/i.test(url)) return 'apple_music';
  if (/open\.spotify\.com/i.test(url)) return 'spotify';
  if (/jiosaavn\.com|saavn\.com/i.test(url)) return 'jiosaavn';
  if (/gaana\.com/i.test(url)) return 'gaana';
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/soundcloud\.com/i.test(url)) return 'soundcloud';
  if (/instagram\.com/i.test(url)) return 'instagram';
  return 'generic';
}

// 1. Apple Music via iTunes Search API (Official Apple CDN)
async function inspectAppleMusic(url) {
  const songMatch = url.match(/[?&]i=([0-9]+)/);
  const albumMatch = url.match(/album\/(?:[^/]+\/)?([0-9]+)/);
  const id = songMatch ? songMatch[1] : (albumMatch ? albumMatch[1] : null);
  const countryMatch = url.match(/music\.apple\.com\/([a-z]{2})\//i);
  const country = countryMatch ? countryMatch[1].toLowerCase() : 'us';

  if (!id) {
    throw new Error('Could not find Apple Music album or song ID in URL.');
  }

  const itunesUrl = `https://itunes.apple.com/lookup?id=${id}&country=${country}&entity=song`;
  const res = await fetch(itunesUrl, {
    headers: { 'Accept': 'application/json' }
  });

  if (!res.ok) {
    throw new Error('Apple Music inspection failed.');
  }

  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error('Media not found on Apple Music.');
  }

  const isSongExplicit = Boolean(songMatch);
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
      return {
        id: String(t.trackId || idx + 1),
        trackNumber: t.trackNumber || idx + 1,
        title: t.trackName || `Track ${idx + 1}`,
        artist: t.artistName || parentCollection.artistName,
        album: parentCollection.collectionName,
        artwork: artwork,
        durationMs: durMs,
        durationString: formatTime(durMs / 1000),
        sizeFormatted: `~${formatBytes(tEstBytes)}`,
        previewUrl: t.previewUrl || null,
        url: t.trackViewUrl || url,
        searchQuery: `${t.artistName || parentCollection.artistName} - ${t.trackName} audio`
      };
    });

    const totalEstBytes = Math.round((totalDurationMs / 1000) * 40 * 1024);
    const sizeStr = `~${formatBytes(totalEstBytes)}`;

    return {
      platform: 'apple_music',
      platformName: 'Apple Music',
      platformIcon: '🍎',
      type: 'album',
      id: String(parentCollection.collectionId || id),
      title: parentCollection.collectionName,
      artist: parentCollection.artistName,
      artwork: artwork,
      genre: parentCollection.primaryGenreName || 'Music',
      year: parentCollection.releaseDate ? new Date(parentCollection.releaseDate).getFullYear() : '2024',
      tracks: tracks.length > 0 ? tracks : [{
        id: String(id),
        trackNumber: 1,
        title: parentCollection.collectionName,
        artist: parentCollection.artistName,
        album: parentCollection.collectionName,
        artwork: artwork,
        durationMs: 210000,
        durationString: '3:30',
        sizeFormatted: '~7 MB',
        previewUrl: first.previewUrl || null,
        url: url,
        searchQuery: `${parentCollection.artistName} - ${parentCollection.collectionName} audio`
      }],
      totalTracks: tracks.length || 1,
      totalDurationMs: totalDurationMs || 210000,
      totalSizeFormatted: sizeStr,
      url: url,
      mediaFormats: ['mp3', 'alac', 'flac']
    };
  } else {
    // Single track
    const track = data.results.find(r => r.wrapperType === 'track') || first;
    const durMs = track.trackTimeMillis || 210000;
    const estBytes = Math.round((durMs / 1000) * 40 * 1024);
    const artwork = (track.artworkUrl100 || '').replace('100x100bb.jpg', '3000x3000bb.jpg');
    const sizeStr = `~${formatBytes(estBytes)}`;

    return {
      platform: 'apple_music',
      platformName: 'Apple Music',
      platformIcon: '🍎',
      type: 'track',
      id: String(track.trackId || id),
      title: track.trackName || track.collectionName,
      artist: track.artistName,
      album: track.collectionName || track.trackName,
      artwork: artwork,
      durationMs: durMs,
      durationString: formatTime(durMs / 1000),
      sizeFormatted: sizeStr,
      estimatedSizes: { mp3: sizeStr, flac: `~${formatBytes(estBytes * 3)}` },
      previewUrl: track.previewUrl || null,
      url: track.trackViewUrl || url,
      searchQuery: `${track.artistName} - ${track.trackName} audio`,
      mediaFormats: ['mp3', 'alac', 'flac']
    };
  }
}

// 2. JioSaavn Inspection (Search API & Slug Fallback)
async function inspectJioSaavn(url) {
  const slugMatch = url.match(/(?:song|album)\/([^/]+)/i);
  const rawSlug = slugMatch ? slugMatch[1].replace(/[-_]/g, ' ').trim() : '';

  try {
    const query = rawSlug || 'Song';
    const saavnApi = `https://www.jiosaavn.com/api.php?__call=search.getResults&q=${encodeURIComponent(query)}&_format=json&_marker=0&ctx=web6dot0`;
    const sRes = await fetch(saavnApi, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (sRes.ok) {
      const sData = await sRes.json();
      if (sData.results && sData.results.length > 0) {
        const item = sData.results[0];
        const artwork = (item.image || '').replace('150x150', '500x500');
        const durSec = parseInt(item.duration, 10) || 240;
        return {
          platform: 'jiosaavn',
          platformName: 'JioSaavn',
          platformIcon: '🟢',
          type: 'track',
          id: item.id || `jiosaavn_${Date.now()}`,
          title: item.song || rawSlug || 'JioSaavn Track',
          artist: item.primary_artists || item.singers || 'JioSaavn Artist',
          album: item.album || item.song || 'JioSaavn',
          artwork: artwork,
          durationMs: durSec * 1000,
          durationString: formatTime(durSec),
          url: url,
          previewUrl: item.media_preview_url || null,
          searchQuery: `${item.primary_artists || ''} - ${item.song || rawSlug} audio`,
          mediaFormats: ['mp3'],
          sizeFormatted: '~9.6 MB',
          estimatedSizes: { mp3: '~9.6 MB' }
        };
      }
    }
  } catch (err) {
    console.warn('JioSaavn API search failed, using fallback:', err.message);
  }

  const title = rawSlug ? rawSlug.replace(/\b\w/g, l => l.toUpperCase()) : 'JioSaavn Track';
  return {
    platform: 'jiosaavn',
    platformName: 'JioSaavn',
    platformIcon: '🟢',
    type: 'track',
    id: `jiosaavn_${Date.now()}`,
    title: title,
    artist: 'JioSaavn Artist',
    album: title,
    artwork: 'https://appllifymusic.netlify.app/og-banner.png',
    durationMs: 240000,
    durationString: '4:00',
    url: url,
    searchQuery: `${title} audio`,
    mediaFormats: ['mp3'],
    sizeFormatted: '~9.6 MB',
    estimatedSizes: { mp3: '~9.6 MB' }
  };
}

// 3. Spotify Inspection via Spotify oEmbed
async function inspectSpotify(url) {
  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  const res = await fetch(oembedUrl);

  if (!res.ok) {
    throw new Error('Spotify URL could not be resolved.');
  }

  const data = await res.json();
  const isPlaylist = /playlist|album/i.test(url);
  const title = data.title || 'Spotify Media';
  const artist = data.author_name || (isPlaylist ? 'Curated Playlist' : 'Spotify Artist');
  const artwork = data.thumbnail_url || null;

  return {
    platform: 'spotify',
    platformName: 'Spotify',
    platformIcon: '🟢',
    type: isPlaylist ? 'playlist' : 'track',
    id: `spotify_${Date.now()}`,
    title: title,
    artist: artist,
    album: title,
    artwork: artwork,
    durationMs: 210000,
    durationString: '3:30',
    url: url,
    searchQuery: `${artist} - ${title} audio`,
    mediaFormats: ['mp3'],
    sizeFormatted: '~8.4 MB',
    estimatedSizes: { mp3: '~8.4 MB' }
  };
}

// 4. Gaana Inspection
async function inspectGaana(url) {
  const slugMatch = url.match(/(?:song|album)\/([^/]+)/i);
  const rawSlug = slugMatch ? slugMatch[1].replace(/[-_]/g, ' ').trim() : '';

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });

    if (res.ok) {
      const html = await res.text();
      const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || html.match(/<title>([^<]+)<\/title>/i);
      const imgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);

      let title = titleMatch ? titleMatch[1].replace(/Song Download:.*$/i, '').replace(/MP3 Song.*$/i, '').replace(/\|.*$/i, '').trim() : rawSlug;
      let artist = 'Gaana Artist';
      if (descMatch) {
        const artistMatch = descMatch[1].match(/(?:by|sung by|artist[s]?[:\s]+)([^,.]+)/i);
        if (artistMatch) artist = artistMatch[1].trim();
      }

      const artwork = imgMatch ? imgMatch[1] : null;
      const isPlaylist = /playlist|album/i.test(url);

      return {
        platform: 'gaana',
        platformName: 'Gaana',
        platformIcon: '🔴',
        type: isPlaylist ? 'playlist' : 'track',
        id: `gaana_${Date.now()}`,
        title: title || 'Gaana Track',
        artist: artist,
        album: title || 'Gaana',
        artwork: artwork,
        durationMs: 210000,
        durationString: '3:30',
        url: url,
        searchQuery: `${artist} - ${title} audio`,
        mediaFormats: ['mp3'],
        sizeFormatted: '~8.4 MB',
        estimatedSizes: { mp3: '~8.4 MB' }
      };
    }
  } catch (err) {
    console.warn('Gaana page fetch failed, using slug:', err.message);
  }

  const title = rawSlug ? rawSlug.replace(/\b\w/g, l => l.toUpperCase()) : 'Gaana Track';
  return {
    platform: 'gaana',
    platformName: 'Gaana',
    platformIcon: '🔴',
    type: 'track',
    id: `gaana_${Date.now()}`,
    title: title,
    artist: 'Gaana Artist',
    album: title,
    artwork: 'https://appllifymusic.netlify.app/og-banner.png',
    durationMs: 210000,
    durationString: '3:30',
    url: url,
    searchQuery: `${title} audio`,
    mediaFormats: ['mp3'],
    sizeFormatted: '~8.4 MB',
    estimatedSizes: { mp3: '~8.4 MB' }
  };
}

// 5. YouTube via oEmbed
async function inspectYouTube(url) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetch(oembedUrl);

  if (!res.ok) {
    throw new Error('YouTube video not found or private.');
  }

  const data = await res.json();
  return {
    platform: 'youtube',
    platformName: 'YouTube',
    platformIcon: '🔴',
    type: 'video',
    id: `yt_${Date.now()}`,
    title: data.title || 'YouTube Video',
    artist: data.author_name || 'YouTube Creator',
    album: 'YouTube',
    artwork: data.thumbnail_url || null,
    durationMs: 240000,
    durationString: '4:00',
    url: url,
    searchQuery: `${data.author_name} - ${data.title} audio`,
    mediaFormats: ['mp3', 'mp4'],
    sizeFormatted: '~9.6 MB',
    estimatedSizes: { mp3: '~9.6 MB', mp4: '~28.4 MB' }
  };
}

// 6. SoundCloud via oEmbed
async function inspectSoundCloud(url) {
  const oembedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetch(oembedUrl);

  if (!res.ok) {
    throw new Error('SoundCloud track could not be loaded.');
  }

  const data = await res.json();
  return {
    platform: 'soundcloud',
    platformName: 'SoundCloud',
    platformIcon: '🟠',
    type: 'track',
    id: `sc_${Date.now()}`,
    title: data.title || 'SoundCloud Track',
    artist: data.author_name || 'SoundCloud Artist',
    album: 'SoundCloud',
    artwork: data.thumbnail_url || null,
    durationMs: 200000,
    durationString: '3:20',
    url: url,
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
    let url = '';
    if (event.httpMethod === 'POST' && event.body) {
      const parsed = JSON.parse(event.body);
      url = parsed.url;
    } else if (event.queryStringParameters && event.queryStringParameters.url) {
      url = event.queryStringParameters.url;
    }

    url = (url || '').trim();
    if (!url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Please provide a valid music link.' })
      };
    }

    const platform = detectPlatform(url);
    let media = null;

    if (platform === 'apple_music') {
      media = await inspectAppleMusic(url);
    } else if (platform === 'jiosaavn') {
      media = await inspectJioSaavn(url);
    } else if (platform === 'spotify') {
      media = await inspectSpotify(url);
    } else if (platform === 'gaana') {
      media = await inspectGaana(url);
    } else if (platform === 'youtube') {
      media = await inspectYouTube(url);
    } else if (platform === 'soundcloud') {
      media = await inspectSoundCloud(url);
    } else {
      // Generic fallback
      media = {
        platform: 'generic',
        platformName: 'Universal Web',
        platformIcon: '🌐',
        type: 'track',
        id: `web_${Date.now()}`,
        title: 'Online Music Track',
        artist: 'Web Artist',
        album: 'Universal',
        artwork: 'https://appllifymusic.netlify.app/og-banner.png',
        durationMs: 180000,
        durationString: '3:00',
        url: url,
        searchQuery: `Music track audio`,
        mediaFormats: ['mp3'],
        sizeFormatted: '~7.2 MB',
        estimatedSizes: { mp3: '~7.2 MB' }
      };
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
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: err.message || 'Inspection failed on server.'
      })
    };
  }
};
