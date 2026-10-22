const path = require('path');

function parseAppleMusicUrl(rawUrl) {
  try {
    const url = new URL(rawUrl.trim());
    const parts = url.pathname.split('/').filter(Boolean);
    let storefront = 'us';
    let albumId = null;
    let trackId = url.searchParams.get('i');

    if (parts[0] && parts[0].length === 2 && !['album', 'artist', 'playlist', 'song'].includes(parts[0])) {
      storefront = parts[0].toLowerCase();
    }

    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'album' || parts[i] === 'song') {
        for (let j = i + 1; j < parts.length; j++) {
          const match = parts[j].match(/^(?:id)?(\d+)$/);
          if (match) {
            albumId = match[1];
            break;
          }
        }
      }
    }

    if (!albumId) {
      const match = url.pathname.match(/(\d{6,})/);
      if (match) albumId = match[1];
    }

    return { storefront, albumId, trackId };
  } catch (e) {
    return null;
  }
}

function parseDurationToMs(isoDuration) {
  if (!isoDuration || typeof isoDuration !== 'string') return 0;
  const match = isoDuration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const mins = parseInt(match[1] || '0', 10);
  const secs = parseInt(match[2] || '0', 10);
  return (mins * 60 + secs) * 1000;
}

function cleanArtworkUrl(url, size = 3000) {
  if (!url) return null;
  return url
    .replace(/\/(\d+)x(\d+)(bb|bf|sr)?(\.[a-z]+)$/i, `/${size}x${size}$3$4`)
    .replace(/\{w\}x\{h\}(bb)?/i, `${size}x${size}$1`);
}

async function scrapeAppleMusicPage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!res.ok) return null;
    const html = await res.text();

    const schemaMatch = html.match(
      /<script[^>]*schema:music-album[^>]*>([\s\S]*?)<\/script>/i
    ) || html.match(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
    );

    if (!schemaMatch) return null;

    const data = JSON.parse(schemaMatch[1]);
    if (!data || (data['@type'] !== 'MusicAlbum' && !data.tracks)) return null;

    let artists = [];
    if (Array.isArray(data.byArtist)) {
      artists = data.byArtist.map(a => a.name);
    } else if (data.byArtist && data.byArtist.name) {
      artists = [data.byArtist.name];
    }

    const artistName = artists.join(', ') || 'Unknown Artist';
    let artwork = data.image || null;
    if (typeof artwork === 'object' && artwork.url) artwork = artwork.url;
    artwork = cleanArtworkUrl(artwork, 3000);

    const tracks = (data.tracks || []).map((t, idx) => ({
      id: t.url ? t.url.split('/').pop() : `${idx + 1}`,
      trackNumber: idx + 1,
      discNumber: 1,
      title: t.name,
      artist: artistName,
      durationMs: parseDurationToMs(t.duration),
      previewUrl: t.audio?.contentUrl || null
    }));

    return {
      id: url.split('/').pop().replace(/\D/g, '') || 'album',
      title: data.name,
      artist: artistName,
      artwork: artwork,
      releaseDate: data.datePublished || '',
      year: data.datePublished ? new Date(data.datePublished).getFullYear() : '',
      genre: data.genre || 'Music',
      trackCount: tracks.length,
      tracks: tracks
    };
  } catch (err) {
    return null;
  }
}

async function fetchAppleMusicAlbum(albumIdOrUrl, preferredStorefront = null) {
  let albumId = albumIdOrUrl;
  let country = preferredStorefront || 'us';
  let originalUrl = null;

  if (albumIdOrUrl.startsWith('http')) {
    originalUrl = albumIdOrUrl;
    const parsed = parseAppleMusicUrl(albumIdOrUrl);
    if (!parsed || !parsed.albumId) {
      throw new Error('Could not parse album ID from the provided Apple Music link.');
    }
    albumId = parsed.albumId;
    if (parsed.storefront) country = parsed.storefront;
  }

  // 1. First try iTunes lookup API with target storefront
  const tryLookup = async (id, c) => {
    try {
      const resp = await fetch(
        `https://itunes.apple.com/lookup?id=${id}&entity=song&country=${c}`
      );
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  };

  let data = await tryLookup(albumId, country);

  // If not found, try fallback countries
  if (!data || !data.results || data.results.length === 0) {
    const fallbackCountries = ['us', 'in', 'gb', 'ca', 'au', 'jp', 'de'].filter(
      c => c !== country
    );
    for (const fc of fallbackCountries) {
      data = await tryLookup(albumId, fc);
      if (data && data.results && data.results.length > 0) {
        country = fc;
        break;
      }
    }
  }

  // 2. If iTunes lookup found results
  if (data && data.results && data.results.length > 0) {
    let albumInfo = data.results.find(r => r.wrapperType === 'collection');
    let tracks = data.results.filter(r => r.wrapperType === 'track');

    // If query was for a track ID rather than collection ID
    if (!albumInfo && tracks.length > 0 && tracks[0].collectionId) {
      const colId = tracks[0].collectionId;
      const colData = await tryLookup(colId, country);
      if (colData && colData.results && colData.results.length > 0) {
        albumInfo = colData.results.find(r => r.wrapperType === 'collection');
        tracks = colData.results.filter(r => r.wrapperType === 'track');
      }
    }

    if (albumInfo || tracks.length > 0) {
      const info = albumInfo || tracks[0];
      const artwork = cleanArtworkUrl(info.artworkUrl100, 3000);
      const year = info.releaseDate ? new Date(info.releaseDate).getFullYear() : '';

      return {
        id: info.collectionId || albumId,
        title: info.collectionName,
        artist: info.artistName,
        artwork: artwork,
        releaseDate: info.releaseDate ? info.releaseDate.split('T')[0] : '',
        year: year,
        genre: info.primaryGenreName || 'Music',
        trackCount: tracks.length,
        copyright: albumInfo?.copyright || '',
        tracks: tracks.map((t, idx) => ({
          id: t.trackId || `${idx + 1}`,
          trackNumber: t.trackNumber || idx + 1,
          discNumber: t.discNumber || 1,
          title: t.trackName,
          artist: t.artistName || info.artistName,
          album: info.collectionName,
          durationMs: t.trackTimeMillis || 0,
          previewUrl: t.previewUrl || null
        }))
      };
    }
  }

  // 3. Fallback: Scrape Apple Music webpage directly
  if (originalUrl) {
    const scraped = await scrapeAppleMusicPage(originalUrl);
    if (scraped && scraped.tracks.length > 0) {
      return scraped;
    }
  }

  throw new Error(
    'Unable to find album details for this link. Please check that the Apple Music URL is valid and publicly accessible.'
  );
}

module.exports = {
  parseAppleMusicUrl,
  fetchAppleMusicAlbum,
  cleanArtworkUrl
};
