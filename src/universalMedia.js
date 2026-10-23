const dns = require('dns');
if (dns && dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
const { spawn } = require('child_process');
const path = require('path');
const { fetchAppleMusicAlbum } = require('./appleMusic');

const YTDLP_PATH = path.join(__dirname, '../bin/yt-dlp');

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
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/soundcloud\.com/i.test(url)) return 'soundcloud';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter_x';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  return 'generic';
}

async function resolveSpotify(url) {
  const match = url.match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('Invalid Spotify URL');

  const type = match[1];
  const id = match[2];
  const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;

  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!res.ok) throw new Error('Could not fetch Spotify metadata');
  const html = await res.text();

  const scriptMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error('Could not parse Spotify page data');

  const nextData = JSON.parse(scriptMatch[1]);
  const entity = nextData.props?.pageProps?.state?.data?.entity;

  if (!entity) throw new Error('Spotify entity not found');

  if (type === 'track') {
    const artist = entity.artists?.map(a => a.name).join(', ') || entity.subtitle || 'Unknown Artist';
    const artwork = entity.visualIdentity?.image?.[0]?.url || null;
    const durationMs = entity.duration || 0;
    const estMp3Bytes = Math.round((durationMs / 1000) * 40 * 1024);
    const sizeStr = `~${formatBytes(estMp3Bytes)}`;

    return {
      platform: 'spotify',
      platformName: 'Spotify',
      platformIcon: '🟢',
      type: 'track',
      id: entity.id || id,
      title: entity.title || entity.name,
      artist: artist,
      album: entity.album?.name || entity.title,
      artwork: artwork,
      durationMs: durationMs,
      durationString: formatTime(durationMs / 1000),
      url: url,
      searchQuery: `${artist} - ${entity.title || entity.name} audio`,
      mediaFormats: ['mp3'],
      sizeFormatted: sizeStr,
      estimatedSizes: { mp3: sizeStr }
    };
  }

  if (type === 'album' || type === 'playlist') {
    const title = entity.title || entity.name;
    const artist = entity.subtitle || (type === 'album' ? 'Spotify Album' : 'Spotify Playlist');
    const artwork = entity.visualIdentity?.image?.[0]?.url || null;
    const trackList = entity.trackList || [];

    let totalDurationMs = 0;
    const tracks = trackList.map((t, idx) => {
      const durMs = t.duration || 0;
      totalDurationMs += durMs;
      const tEstBytes = Math.round((durMs / 1000) * 40 * 1024);
      return {
        id: t.uid || `spotify_${idx}`,
        trackNumber: idx + 1,
        title: t.title,
        artist: t.subtitle || artist,
        album: title,
        artwork: artwork,
        durationMs: durMs,
        durationString: formatTime(durMs / 1000),
        sizeFormatted: `~${formatBytes(tEstBytes)}`,
        url: `https://open.spotify.com/track/${t.uri ? t.uri.replace('spotify:track:', '') : ''}`,
        searchQuery: `${t.subtitle || artist} - ${t.title} audio`
      };
    });

    const totalEstBytes = Math.round((totalDurationMs / 1000) * 40 * 1024);

    return {
      platform: 'spotify',
      platformName: 'Spotify',
      platformIcon: '🟢',
      type: type,
      id: entity.id || id,
      title: title,
      artist: artist,
      artwork: artwork,
      tracks: tracks,
      totalTracks: tracks.length,
      totalDurationMs: totalDurationMs,
      totalSizeFormatted: `~${formatBytes(totalEstBytes)}`,
      url: url,
      mediaFormats: ['mp3']
    };
  }

  throw new Error(`Unsupported Spotify type: ${type}`);
}

function resolveWithYtDlp(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--js-runtimes', `node:${process.execPath}`,
      '-j',
      '--flat-playlist',
      '--no-warnings',
      url
    ];

    const proc = spawn(YTDLP_PATH, args);
    let output = '';
    let errOutput = '';

    proc.stdout.on('data', data => {
      output += data.toString();
    });

    proc.stderr.on('data', data => {
      errOutput += data.toString();
    });

    proc.on('close', code => {
      if (code !== 0 && !output.trim()) {
        return reject(new Error(errOutput || `Could not inspect URL (code ${code})`));
      }

      const lines = output.trim().split('\n').filter(Boolean);
      if (lines.length === 0) {
        return reject(new Error('No media information found for this URL.'));
      }

      try {
        const first = JSON.parse(lines[0]);
        const extractor = (first.extractor || '').toLowerCase();

        let platform = 'generic';
        let platformName = 'Web Media';
        let platformIcon = '🌐';

        if (extractor.includes('youtube')) {
          platform = 'youtube';
          platformName = 'YouTube';
          platformIcon = '🔴';
        } else if (extractor.includes('jiosaavn') || extractor.includes('saavn')) {
          platform = 'jiosaavn';
          platformName = 'JioSaavn';
          platformIcon = '🟢';
        } else if (extractor.includes('gaana')) {
          platform = 'gaana';
          platformName = 'Gaana';
          platformIcon = '🔴';
        } else if (extractor.includes('soundcloud')) {
          platform = 'soundcloud';
          platformName = 'SoundCloud';
          platformIcon = '🟠';
        } else if (extractor.includes('instagram')) {
          platform = 'instagram';
          platformName = 'Instagram';
          platformIcon = '📸';
        } else if (extractor.includes('twitter') || extractor.includes('x')) {
          platform = 'twitter_x';
          platformName = 'X / Twitter';
          platformIcon = '𝕏';
        } else if (extractor.includes('tiktok')) {
          platform = 'tiktok';
          platformName = 'TikTok';
          platformIcon = '🎵';
        }

        const isPlaylist = lines.length > 1;

        if (isPlaylist) {
          let totalDur = 0;
          const tracks = lines.map((l, idx) => {
            try {
              const item = JSON.parse(l);
              const dur = item.duration || 0;
              totalDur += dur;
              const tEstBytes = Math.round(dur * 40 * 1024);
              return {
                id: item.id || `item_${idx}`,
                trackNumber: idx + 1,
                title: item.title,
                artist: item.uploader || item.channel || platformName,
                durationMs: dur * 1000,
                durationString: item.duration_string || formatTime(dur),
                sizeFormatted: `~${formatBytes(tEstBytes)}`,
                url: item.url || item.webpage_url || `https://www.youtube.com/watch?v=${item.id}`,
                artwork: (item.thumbnails && item.thumbnails.length > 0)
                  ? item.thumbnails[item.thumbnails.length - 1].url
                  : null
              };
            } catch (e) {
              return null;
            }
          }).filter(Boolean);

          const playlistTitle = first.playlist_title || first.playlist || `${platformName} Playlist`;
          const playlistArtwork = tracks[0]?.artwork || null;
          const totalEstBytes = Math.round(totalDur * 40 * 1024);

          return resolve({
            platform,
            platformName,
            platformIcon,
            type: 'playlist',
            id: first.playlist_id || 'playlist',
            title: playlistTitle,
            artist: first.uploader || first.channel || platformName,
            artwork: playlistArtwork,
            tracks: tracks,
            totalTracks: tracks.length,
            totalSizeFormatted: `~${formatBytes(totalEstBytes)}`,
            url: url,
            mediaFormats: ['mp3', 'mp4']
          });
        }

        // Single media item
        const thumb = (first.thumbnails && first.thumbnails.length > 0)
          ? first.thumbnails[first.thumbnails.length - 1].url
          : (first.thumbnail || null);

        const duration = first.duration || 0;
        const title = first.title || first.fulltitle || 'Untitled Media';
        const artist = first.artist || first.uploader || first.channel || first.creator || platformName;

        const isAudioOnly = platform === 'soundcloud';
        const formats = isAudioOnly ? ['mp3'] : ['mp4', 'mp3'];

        const estMp3Bytes = Math.round(duration * 40 * 1024);
        const exactOrEstMp4Bytes = first.filesize || first.filesize_approx || Math.round(duration * 280 * 1024);
        const estimatedSizes = {
          mp3: `~${formatBytes(estMp3Bytes)}`,
          mp4: (first.filesize || first.filesize_approx) ? formatBytes(first.filesize || first.filesize_approx) : `~${formatBytes(exactOrEstMp4Bytes)}`
        };
        const sizeFormatted = isAudioOnly ? estimatedSizes.mp3 : estimatedSizes.mp4;

        return resolve({
          platform,
          platformName,
          platformIcon,
          type: platform === 'instagram' ? 'reel' : (isAudioOnly ? 'track' : 'video'),
          id: first.id || 'item',
          title: title,
          artist: artist,
          album: first.album || title,
          artwork: thumb,
          durationMs: duration * 1000,
          durationString: first.duration_string || formatTime(duration),
          url: url,
          mediaFormats: formats,
          sizeFormatted,
          estimatedSizes
        });
      } catch (err) {
        reject(new Error(`Failed to parse media details: ${err.message}`));
      }
    });

    proc.on('error', err => {
      reject(err);
    });
  });
}

async function resolveGaana(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (res.ok) {
      const html = await res.text();
      const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || html.match(/<title>([^<]+)<\/title>/i);
      const imgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);

      let title = titleMatch ? titleMatch[1].replace(/Song Download:.*$/i, '').replace(/MP3 Song.*$/i, '').replace(/\|.*$/i, '').trim() : 'Gaana Song';
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
        title: title,
        artist: artist,
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
    console.warn('Gaana scrape fallback:', err.message);
  }

  // Fallback to yt-dlp
  return await resolveWithYtDlp(url);
}

async function resolveJioSaavn(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (res.ok) {
      const html = await res.text();
      const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || html.match(/<title>([^<]+)<\/title>/i);
      const imgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);

      let title = 'JioSaavn Track';
      let artist = 'JioSaavn Artist';
      let album = 'JioSaavn';

      if (titleMatch) {
        let rawTitle = titleMatch[1];
        rawTitle = rawTitle.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        const parts = rawTitle.split(/ - | @ /);
        title = parts[0].replace(/\(Full Song\)/i, '').trim();
        if (parts.length > 1) {
          album = parts[1].replace(/Song Download from/i, '').replace(/Download or Listen Free/i, '').trim();
        }
      }

      // Prioritize meta name="description" which has "song by Pritam, Arijit Singh... from"
      const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
      if (metaDescMatch) {
        let mDesc = metaDescMatch[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        const songByMatch = mDesc.match(/song by\s+([^from]+?)\s+from/i);
        if (songByMatch) {
          artist = songByMatch[1].trim();
        }
      } else if (descMatch) {
        let desc = descMatch[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        const artistMatch = desc.match(/song by\s+([^from]+?)\s+from/i) || desc.match(/(?:by|sung by|singers?[:\s]+)([^,.]+)/i);
        if (artistMatch) artist = artistMatch[1].trim();
      }

      let artwork = imgMatch ? imgMatch[1] : null;
      if (artwork && artwork.includes('150x150')) {
        artwork = artwork.replace('150x150', '500x500');
      }

      const isPlaylist = /playlist|album/i.test(url);

      return {
        platform: 'jiosaavn',
        platformName: 'JioSaavn',
        platformIcon: '🟢',
        type: isPlaylist ? 'playlist' : 'track',
        id: `jiosaavn_${Date.now()}`,
        title: title,
        artist: artist,
        album: album,
        artwork: artwork,
        durationMs: 240000,
        durationString: '4:00',
        url: url,
        searchQuery: `${artist} - ${title} audio`,
        mediaFormats: ['mp3'],
        sizeFormatted: '~9.6 MB',
        estimatedSizes: { mp3: '~9.6 MB' }
      };
    }
  } catch (err) {
    console.warn('JioSaavn scrape fallback:', err.message);
  }

  // Fallback to yt-dlp
  return await resolveWithYtDlp(url);
}

async function inspectUniversalUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) throw new Error('Please provide a URL to inspect.');

  const platform = detectPlatform(url);

  if (platform === 'apple_music') {
    const albumData = await fetchAppleMusicAlbum(url);
    const isSingle = albumData.tracks && albumData.tracks.length === 1;

    let totalSizeFormatted = null;
    if (albumData.tracks && albumData.tracks.length > 0) {
      let totalDurSec = 0;
      albumData.tracks.forEach(t => {
        const durSec = (t.durationMs || 0) / 1000;
        totalDurSec += durSec;
        t.sizeFormatted = `~${formatBytes(Math.round(durSec * 40 * 1024))}`;
      });
      totalSizeFormatted = `~${formatBytes(Math.round(totalDurSec * 40 * 1024))}`;
      albumData.totalSizeFormatted = totalSizeFormatted;
    }

    const singleDurSec = isSingle && albumData.tracks[0]?.durationMs ? albumData.tracks[0].durationMs / 1000 : 0;
    const singleSizeStr = isSingle ? `~${formatBytes(Math.round(singleDurSec * 40 * 1024))}` : null;

    return {
      platform: 'apple_music',
      platformName: 'Apple Music',
      platformIcon: '🎵',
      type: isSingle ? 'track' : 'album',
      id: albumData.id,
      title: albumData.title,
      artist: albumData.artist,
      artwork: albumData.artwork,
      genre: albumData.genre,
      year: albumData.year,
      tracks: albumData.tracks,
      totalTracks: albumData.tracks ? albumData.tracks.length : 1,
      totalSizeFormatted: totalSizeFormatted,
      durationMs: isSingle ? (albumData.tracks[0].durationMs || 0) : 0,
      durationString: isSingle && albumData.tracks[0].durationMs ? formatTime(albumData.tracks[0].durationMs / 1000) : null,
      sizeFormatted: singleSizeStr,
      estimatedSizes: singleSizeStr ? { mp3: singleSizeStr } : null,
      url: url,
      mediaFormats: ['mp3'],
      appleMusicRaw: albumData
    };
  }

  if (platform === 'spotify') {
    return await resolveSpotify(url);
  }

  if (platform === 'jiosaavn') {
    return await resolveJioSaavn(url);
  }

  if (platform === 'gaana') {
    return await resolveGaana(url);
  }

  // All other platforms: JioSaavn, YouTube, SoundCloud, Instagram, Twitter/X, TikTok, Generic
  return await resolveWithYtDlp(url);
}

module.exports = {
  detectPlatform,
  inspectUniversalUrl
};
