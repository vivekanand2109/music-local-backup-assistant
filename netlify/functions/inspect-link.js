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

// 1. Apple Music via iTunes Search API & Playlist Scraping
async function inspectAppleMusic(parsedUrl) {
  const urlStr = parsedUrl.toString();

  // A. Check for Apple Music Playlist
  if (parsedUrl.pathname.includes('/playlist/')) {
    try {
      const pageRes = await safeFetch(urlStr, { maxBytes: 4 * 1024 * 1024, timeoutMs: 12000 });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const m = html.match(/<script[^>]*id=\"serialized-server-data\"[^>]*>([\s\S]*?)<\/script>/);
        if (m) {
          const sData = JSON.parse(m[1]);
          const payload = sData.data?.['0']?.data;
          if (payload) {
            const headerSec = payload.sections?.find(s => s.items && s.items[0]?.title);
            const playlistTitle = headerSec?.items?.[0]?.title || 'Apple Music Playlist';
            const playlistArt = (headerSec?.items?.[0]?.artwork?.dictionary?.url || '')
              .replace('{w}x{h}bb.{f}', '1000x1000bb.jpg')
              .replace('{w}x{h}mv.{f}', '1000x1000bb.jpg');

            const trackSection = payload.sections?.find(s => s.items && s.items.length > 5);
            const rawItems = trackSection?.items || [];
            if (rawItems.length > 0) {
              const tracks = rawItems.map((item, idx) => {
                const durMs = item.duration || 210000;
                const trackId = String(item.id || idx + 1);
                return {
                  id: trackId,
                  trackNumber: item.trackNumber || idx + 1,
                  title: item.title || `Track ${idx + 1}`,
                  artist: item.artistName || 'Artist',
                  album: playlistTitle,
                  artwork: playlistArt || 'https://appllifymusic.netlify.app/og-banner.png',
                  durationMs: durMs,
                  durationString: formatTime(durMs / 1000),
                  sizeFormatted: '~8.4 MB',
                  previewUrl: null, // Resolved safely via iTunes search CDN
                  downloadToken: generateDownloadToken(trackId, null),
                  url: urlStr,
                  searchQuery: `${item.title} ${item.artistName || ''}`.trim()
                };
              });

              return {
                platform: 'apple_music',
                platformName: 'Apple Music',
                platformIcon: '🍎',
                type: 'playlist',
                id: `pl_${Date.now()}`,
                title: playlistTitle,
                artist: 'Apple Music Curated',
                artwork: playlistArt || 'https://appllifymusic.netlify.app/og-banner.png',
                genre: 'Top Hits',
                year: '2024',
                tracks: tracks,
                totalTracks: tracks.length,
                totalDurationMs: tracks.reduce((a, b) => a + b.durationMs, 0),
                totalSizeFormatted: `~${tracks.length * 8} MB`,
                url: urlStr,
                mediaFormats: ['mp3', 'alac', 'flac']
              };
            }
          }
        }
      }
    } catch (e) {
      console.warn('Apple Music playlist extraction failed, falling back:', e.message);
    }

    const nameMatch = parsedUrl.pathname.match(/\/playlist\/([^/]+)/);
    const rawName = nameMatch ? nameMatch[1].replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Apple Music Playlist';
    const fallbackTrack = {
      id: `pl_${Date.now()}`,
      trackNumber: 1,
      title: rawName,
      artist: 'Apple Music Curated',
      album: rawName,
      artwork: 'https://appllifymusic.netlify.app/og-banner.png',
      durationMs: 210000,
      durationString: '3:30',
      sizeFormatted: '~8.4 MB',
      previewUrl: null,
      downloadToken: generateDownloadToken(`pl_${Date.now()}`, null),
      url: urlStr,
      searchQuery: `${rawName} Apple Music`.trim()
    };
    return {
      platform: 'apple_music',
      platformName: 'Apple Music',
      platformIcon: '🍎',
      type: 'playlist',
      id: `pl_${Date.now()}`,
      title: rawName,
      artist: 'Apple Music Curated',
      artwork: 'https://appllifymusic.netlify.app/og-banner.png',
      genre: 'Playlist',
      year: '2024',
      tracks: [fallbackTrack],
      totalTracks: 1,
      totalDurationMs: 210000,
      totalSizeFormatted: '~8.4 MB',
      url: urlStr,
      mediaFormats: ['mp3', 'alac', 'flac']
    };
  }

  // B. Album / Song Lookup via iTunes API
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
        searchQuery: `${t.trackName} ${t.artistName || parentCollection.artistName}`.trim()
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
        searchQuery: `${parentCollection.collectionName} ${parentCollection.artistName}`.trim()
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

    const singleTrackObj = {
      id: trackId,
      trackNumber: 1,
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
      searchQuery: `${track.trackName} ${track.artistName}`.trim(),
      mediaFormats: ['mp3', 'alac', 'flac']
    };

    return {
      ...singleTrackObj,
      platform: 'apple_music',
      platformName: 'Apple Music',
      platformIcon: '🍎',
      type: 'track',
      tracks: [singleTrackObj]
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
        const singleTrack = {
          id: trackId,
          trackNumber: 1,
          title: item.song || rawSlug || 'JioSaavn Track',
          artist: item.primary_artists || item.singers || 'JioSaavn Artist',
          album: item.album || item.song || 'JioSaavn',
          artwork: artwork || 'https://appllifymusic.netlify.app/og-banner.png',
          durationMs: durSec * 1000,
          durationString: formatTime(durSec),
          url: urlStr,
          previewUrl: null, // Audio fetched safely via iTunes search CDN
          downloadToken: generateDownloadToken(trackId, null),
          searchQuery: `${item.song || rawSlug} ${item.primary_artists || ''}`.trim(),
          mediaFormats: ['mp3'],
          sizeFormatted: '~9.6 MB',
          estimatedSizes: { mp3: '~9.6 MB' }
        };

        return {
          ...singleTrack,
          platform: 'jiosaavn',
          platformName: 'JioSaavn',
          platformIcon: '🟢',
          type: 'track',
          tracks: [singleTrack]
        };
      }
    }
  } catch (err) {
    console.warn('JioSaavn API search failed, using sanitized fallback');
  }

  const title = rawSlug ? rawSlug.replace(/\b\w/g, l => l.toUpperCase()) : 'JioSaavn Track';
  const trackId = `jiosaavn_${Date.now()}`;
  const fallbackTrack = {
    id: trackId,
    trackNumber: 1,
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

  return {
    ...fallbackTrack,
    platform: 'jiosaavn',
    platformName: 'JioSaavn',
    platformIcon: '🟢',
    type: 'track',
    tracks: [fallbackTrack]
  };
}

// 3. Spotify Inspection via Spotify Embed / oEmbed
async function inspectSpotify(parsedUrl) {
  const urlStr = parsedUrl.toString();

  // A. Check for Spotify Playlist
  const playlistMatch = parsedUrl.pathname.match(/\/playlist\/([a-zA-Z0-9]+)/);
  if (playlistMatch) {
    try {
      const embedUrl = `https://open.spotify.com/embed/playlist/${playlistMatch[1]}`;
      const embedRes = await safeFetch(embedUrl, { maxBytes: 2 * 1024 * 1024 });
      if (embedRes.ok) {
        const html = await embedRes.text();
        const m = html.match(/<script id=\"__NEXT_DATA__\" type=\"application\/json\">([\s\S]*?)<\/script>/);
        if (m) {
          const nextData = JSON.parse(m[1]);
          const entity = nextData.props?.pageProps?.state?.data?.entity;
          if (entity && Array.isArray(entity.trackList) && entity.trackList.length > 0) {
            const pTitle = entity.title || 'Spotify Playlist';
            const pArtist = entity.subtitle || 'Curated Playlist';
            const pArt = entity.coverArt?.sources?.[0]?.url || 'https://appllifymusic.netlify.app/og-banner.png';

            const tracks = entity.trackList.map((t, idx) => {
              const durMs = t.duration || 210000;
              const trackId = `sp_${t.uid || idx + 1}`;
              const pUrl = t.audioPreview?.url || null;
              return {
                id: trackId,
                trackNumber: idx + 1,
                title: t.title || `Track ${idx + 1}`,
                artist: t.subtitle || pArtist,
                album: pTitle,
                artwork: pArt,
                durationMs: durMs,
                durationString: formatTime(durMs / 1000),
                sizeFormatted: '~8.4 MB',
                previewUrl: pUrl,
                downloadToken: generateDownloadToken(trackId, pUrl),
                url: t.uri ? `https://open.spotify.com/track/${t.uri.replace('spotify:track:', '')}` : urlStr,
                searchQuery: `${t.title} ${t.subtitle || ''}`.trim()
              };
            });

            return {
              platform: 'spotify',
              platformName: 'Spotify',
              platformIcon: '🟢',
              type: 'playlist',
              id: `sp_pl_${playlistMatch[1]}`,
              title: pTitle,
              artist: pArtist,
              album: pTitle,
              artwork: pArt,
              genre: 'Curated',
              year: '2024',
              tracks: tracks,
              totalTracks: tracks.length,
              totalDurationMs: tracks.reduce((a, b) => a + b.durationMs, 0),
              totalSizeFormatted: `~${tracks.length * 8} MB`,
              url: urlStr,
              mediaFormats: ['mp3']
            };
          }
        }
      }
    } catch (e) {
      console.warn('Spotify embed extraction failed, falling back to oembed:', e.message);
    }
  }

  // B. Fallback / Single Track oEmbed
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

  const singleTrack = {
    id: trackId,
    trackNumber: 1,
    title: title,
    artist: artist,
    album: title,
    artwork: artwork,
    durationMs: 210000,
    durationString: '3:30',
    url: urlStr,
    previewUrl: null,
    downloadToken: generateDownloadToken(trackId, null),
    searchQuery: `${title} ${artist}`.trim(),
    mediaFormats: ['mp3'],
    sizeFormatted: '~8.4 MB',
    estimatedSizes: { mp3: '~8.4 MB' }
  };

  return {
    ...singleTrack,
    platform: 'spotify',
    platformName: 'Spotify',
    platformIcon: '🟢',
    type: isPlaylist ? 'playlist' : 'track',
    tracks: [singleTrack]
  };
}

// 4. Gaana Inspection - Strictly extracts metadata without fetching arbitrary visitor URL!
async function inspectGaana(parsedUrl) {
  const urlStr = parsedUrl.toString();
  const slugMatch = parsedUrl.pathname.match(/(?:song|album)\/([a-zA-Z0-9-_]+)/i);
  const rawSlug = slugMatch ? slugMatch[1].replace(/[-_]/g, ' ').replace(/[^a-zA-Z0-9 ]/g, '').trim() : '';
  const title = rawSlug ? rawSlug.replace(/\b\w/g, l => l.toUpperCase()) : 'Gaana Track';

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

  const singleTrack = {
    id: trackId,
    trackNumber: 1,
    title: title,
    artist: artist,
    album: title,
    artwork: artwork,
    durationMs: 210000,
    durationString: '3:30',
    url: urlStr,
    previewUrl: resolvedPreview,
    downloadToken: generateDownloadToken(trackId, resolvedPreview),
    searchQuery: `${title} ${artist}`.trim(),
    mediaFormats: ['mp3'],
    sizeFormatted: '~8.4 MB',
    estimatedSizes: { mp3: '~8.4 MB' }
  };

  return {
    ...singleTrack,
    platform: 'gaana',
    platformName: 'Gaana',
    platformIcon: '🔴',
    type: isPlaylist ? 'playlist' : 'track',
    tracks: [singleTrack]
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

  const singleTrack = {
    id: trackId,
    trackNumber: 1,
    title: data.title || 'YouTube Video',
    artist: data.author_name || 'YouTube Creator',
    album: 'YouTube',
    artwork: data.thumbnail_url || 'https://appllifymusic.netlify.app/og-banner.png',
    durationMs: 240000,
    durationString: '4:00',
    url: urlStr,
    previewUrl: null,
    downloadToken: generateDownloadToken(trackId, null),
    searchQuery: `${data.title} ${data.author_name}`.trim(),
    mediaFormats: ['mp3', 'mp4'],
    sizeFormatted: '~9.6 MB',
    estimatedSizes: { mp3: '~9.6 MB', mp4: '~28.4 MB' }
  };

  return {
    ...singleTrack,
    platform: 'youtube',
    platformName: 'YouTube',
    platformIcon: '🔴',
    type: 'video',
    tracks: [singleTrack]
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

  const singleTrack = {
    id: trackId,
    trackNumber: 1,
    title: data.title || 'SoundCloud Track',
    artist: data.author_name || 'SoundCloud Artist',
    album: 'SoundCloud',
    artwork: data.thumbnail_url || 'https://appllifymusic.netlify.app/og-banner.png',
    durationMs: 200000,
    durationString: '3:20',
    url: urlStr,
    previewUrl: null,
    downloadToken: generateDownloadToken(trackId, null),
    searchQuery: `${data.title} ${data.author_name}`.trim(),
    mediaFormats: ['mp3'],
    sizeFormatted: '~8.0 MB',
    estimatedSizes: { mp3: '~8.0 MB' }
  };

  return {
    ...singleTrack,
    platform: 'soundcloud',
    platformName: 'SoundCloud',
    platformIcon: '🟠',
    type: 'track',
    tracks: [singleTrack]
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

    // Ensure tracks array is always present and non-empty
    if (!media.tracks || !Array.isArray(media.tracks) || media.tracks.length === 0) {
      media.tracks = [{
        id: media.id || `track_${Date.now()}`,
        trackNumber: 1,
        title: media.title || 'Track',
        artist: media.artist || 'Artist',
        album: media.album || media.title || 'Music',
        artwork: media.artwork || 'https://appllifymusic.netlify.app/og-banner.png',
        durationMs: media.durationMs || 210000,
        durationString: media.durationString || '3:30',
        previewUrl: media.previewUrl || null,
        downloadToken: media.downloadToken || generateDownloadToken(media.id, media.previewUrl),
        url: media.url || rawUrl,
        searchQuery: `${media.title} ${media.artist}`.trim()
      }];
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
