const dns = require('dns');
if (dns && dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { fetchAppleMusicAlbum } = require('./appleMusic');
const { downloadAlbum, downloadSingleTrack, downloadCoverArt, downloadUniversalMedia } = require('./downloader');
const { getDownloadedLibrary } = require('./library');
const { inspectUniversalUrl } = require('./universalMedia');
const TunnelManager = require('./tunnel');

const app = express();
const PORT = process.env.PORT || 3300;
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads', 'Apple Music');

// Start Cloudflare Tunnel for worldwide access from anywhere
const tunnel = new TunnelManager(PORT);
tunnel.start();

// Ensure downloads directory exists in Finder
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// SSRF Protection & Safe URL Validator
function isSafeUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return false;
  try {
    const parsed = new URL(inputUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('169.254.') ||
      hostname.endsWith('.local')
    ) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Active SSE client connections
const sseClients = new Set();

function broadcastEvent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function notifyMac(title, message) {
  const safeTitle = (title || 'Apple Music Downloader').replace(/["\\]/g, '');
  const safeMsg = (message || '').replace(/["\\]/g, '');
  exec(`osascript -e 'display notification "${safeMsg}" with title "${safeTitle}"'`, () => {});
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Active download tasks tracker
const activeJobs = new Map();

// Centralized Album Downloader function
function startAlbumDownload(album, source = 'manual', quality = 'lossless', codec = 'alac') {
  const jobId = `album_${Date.now()}_${album.id || 'job'}`;
  const job = {
    id: jobId,
    type: 'album',
    status: 'starting',
    album: album.title,
    artist: album.artist,
    quality,
    codec,
    source,
    cancelled: false,
    currentProc: null,
    tempFiles: new Set()
  };
  activeJobs.set(jobId, job);

  (async () => {
    try {
      const displayQuality = quality === 'hires' ? 'Hi-Res Lossless (24-bit/192kHz)' : (quality === 'lossless' ? 'Lossless ALAC' : 'High Quality (MP3)');
      broadcastEvent('album_started', {
        jobId,
        albumTitle: album.title,
        artist: album.artist,
        artwork: album.artwork,
        totalTracks: album.tracks.length,
        totalSizeFormatted: album.totalSizeFormatted || null,
        quality,
        codec,
        source
      });

      notifyMac('Apple Music Downloader', `Starting download: "${album.title}" • ${displayQuality}`);

      const result = await downloadAlbum(album, DOWNLOADS_DIR, progress => {
        broadcastEvent('download_progress', { jobId, quality, codec, ...progress });
      }, job, quality, codec);

      if (job.cancelled) {
        broadcastEvent('album_cancelled', { jobId, albumTitle: album.title });
        return;
      }

      job.status = 'completed';
      activeJobs.set(jobId, { ...job, result });
      broadcastEvent('album_completed', {
        jobId,
        albumTitle: album.title,
        downloaded: result.downloaded,
        total: result.total,
        totalSizeFormatted: result.totalSizeFormatted,
        albumDir: result.albumDir,
        quality,
        codec
      });

      notifyMac('Apple Music Downloader', `✓ Saved "${album.title}" (${result.totalSizeFormatted || ''}) [${quality.toUpperCase()}] to Finder!`);

      // Automatically reveal in Finder on Mac
      exec(`open "${result.albumDir}"`, () => {});
    } catch (err) {
      if (err.message === 'DOWNLOAD_CANCELLED' || job.cancelled) {
        job.status = 'cancelled';
        broadcastEvent('album_cancelled', { jobId, albumTitle: album.title });
        notifyMac('Download Cancelled', `Cancelled: "${album.title}"`);
        return;
      }
      console.error('Download album failed:', err);
      job.status = 'failed';
      activeJobs.set(jobId, { ...job, error: err.message });
      broadcastEvent('album_failed', { jobId, albumTitle: album.title, error: err.message });
      notifyMac('Download Failed', `Could not download: "${album.title}". ${err.message}`);
    } finally {
      setTimeout(() => activeJobs.delete(jobId), 30000);
    }
  })();

  return jobId;
}

// SSE endpoint for live download progress
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Configuration endpoint
app.get('/api/config', (req, res) => {
  res.json({
    downloadsDir: DOWNLOADS_DIR,
    localIp: getLocalIp()
  });
});

// Network & remote sharing info endpoint
app.get('/api/network-info', (req, res) => {
  const localIp = getLocalIp();
  const publicUrl = tunnel.getPublicUrl();
  res.json({
    localIp,
    port: PORT,
    localUrl: `http://${localIp}:${PORT}`,
    publicUrl: publicUrl || null,
    webUrl: publicUrl || `http://${localIp}:${PORT}`,
    quickDownloadUrl: `${publicUrl || `http://${localIp}:${PORT}`}/api/quick-download?url=`
  });
});

// Universal Link Inspector (Apple Music, Spotify, YouTube, Instagram, SoundCloud, etc.)
app.post('/api/inspect-link', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !isSafeUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid and safe URL (HTTP/HTTPS).' });
  }

  try {
    const media = await inspectUniversalUrl(url.trim());
    return res.json({ success: true, media });
  } catch (err) {
    console.error('Error inspecting link:', err.message);
    return res.status(404).json({ error: err.message || 'Could not fetch details from this link.' });
  }
});

// Fetch album/media metadata (supports Apple Music, Spotify, & universal links)
app.post('/api/fetch-album', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !isSafeUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid and safe URL (HTTP/HTTPS).' });
  }

  try {
    const trimmed = url.trim();
    if (trimmed.includes('music.apple.com')) {
      const albumData = await fetchAppleMusicAlbum(trimmed);
      return res.json({ success: true, album: albumData });
    }

    // Universal inspection for Spotify, YouTube, SoundCloud, etc.
    const media = await inspectUniversalUrl(trimmed);
    if (media.type === 'album' || media.type === 'playlist') {
      return res.json({ success: true, album: media });
    }

    // Single track or video wrapped as an album
    const wrappedAlbum = {
      id: media.id,
      title: media.title,
      artist: media.artist,
      artwork: media.artwork,
      genre: media.platformName || 'Music',
      tracks: [
        {
          id: media.id,
          trackNumber: 1,
          title: media.title,
          artist: media.artist,
          durationMs: media.durationMs || 0,
          url: media.url,
          searchQuery: media.searchQuery
        }
      ]
    };
    return res.json({ success: true, album: wrappedAlbum, media });
  } catch (err) {
    console.error('Error fetching media:', err.message);
    return res.status(404).json({ error: err.message || 'Failed to fetch details from link.' });
  }
});

// 1-Click Album Download
app.post('/api/download-album', async (req, res) => {
  const { album, quality = 'lossless', codec = 'alac' } = req.body;
  if (!album || !album.tracks || album.tracks.length === 0) {
    return res.status(400).json({ error: 'Invalid album object provided.' });
  }

  const jobId = startAlbumDownload(album, 'web', quality, codec);
  res.json({ success: true, jobId, message: `Album download started (${quality.toUpperCase()}).` });
});

// Download Universal Media (Single Track, Reel, YouTube Video, MP3 or MP4)
app.post('/api/download-media', async (req, res) => {
  const { item, format = 'mp3', quality = 'lossless', codec = 'alac' } = req.body;
  if (!item || (!item.url && !item.searchQuery && !item.title)) {
    return res.status(400).json({ error: 'Missing media item data.' });
  }

  const jobId = `media_${Date.now()}_${item.id || 'dl'}`;
  const job = {
    id: jobId,
    type: 'media',
    status: 'downloading',
    title: item.title,
    format,
    quality,
    codec,
    cancelled: false,
    currentProc: null,
    tempFiles: new Set()
  };
  activeJobs.set(jobId, job);

  res.json({ success: true, jobId, message: 'Media download started.' });

  (async () => {
    try {
      const displayLabel = format === 'mp4' ? 'MP4' : (quality === 'hires' ? 'Hi-Res Lossless' : (quality === 'lossless' ? 'Lossless' : 'High Quality'));
      notifyMac('Starting Download', `"${item.title}" (${displayLabel})`);
      broadcastEvent('media_started', {
        jobId,
        title: item.title,
        format,
        quality,
        codec,
        sizeFormatted: item.sizeFormatted || null
      });

      const result = await downloadUniversalMedia(item, format, DOWNLOADS_DIR, progress => {
        broadcastEvent('media_progress', { jobId, title: item.title, format, quality, codec, ...progress });
      }, job, quality, codec);

      if (job.cancelled) {
        broadcastEvent('media_cancelled', { jobId, title: item.title });
        return;
      }

      job.status = 'completed';
      broadcastEvent('media_completed', {
        jobId,
        title: item.title,
        path: result.path,
        format,
        quality: result.quality || quality,
        codec: result.codec || codec,
        fileSize: result.fileSize
      });
      notifyMac('Download Complete ✓', `Saved "${item.title}" (${result.fileSize}) [${(result.quality || quality).toUpperCase()}] to Finder!`);

      exec(`open "${path.dirname(result.path)}"`, () => {});
    } catch (err) {
      if (err.message === 'DOWNLOAD_CANCELLED' || job.cancelled) {
        job.status = 'cancelled';
        broadcastEvent('media_cancelled', { jobId, title: item.title });
        notifyMac('Download Cancelled', `Cancelled: "${item.title}"`);
        return;
      }
      console.error('Download media failed:', err.message);
      job.status = 'failed';
      broadcastEvent('media_failed', { jobId, title: item.title, error: err.message });
      notifyMac('Download Failed', `Could not download: "${item.title}"`);
    } finally {
      setTimeout(() => activeJobs.delete(jobId), 30000);
    }
  })();
});

// Cancel Download Endpoint (Cancels Album, Video, or Single Track)
app.post('/api/cancel-download', (req, res) => {
  const { jobId } = req.body || {};
  let cancelledCount = 0;

  function cancelJob(id, job) {
    if (job && !job.cancelled && job.status !== 'completed') {
      job.cancelled = true;
      job.status = 'cancelled';

      if (job.currentProc) {
        try {
          job.currentProc.kill('SIGTERM');
          setTimeout(() => {
            try { job.currentProc?.kill('SIGKILL'); } catch (e) {}
          }, 800);
        } catch (e) {}
      }

      if (job.tempFiles) {
        for (const file of job.tempFiles) {
          try {
            if (fs.existsSync(file)) fs.unlinkSync(file);
          } catch (e) {}
        }
      }

      if (job.type === 'album') {
        broadcastEvent('album_cancelled', { jobId: id, albumTitle: job.album });
      } else if (job.type === 'track') {
        broadcastEvent('track_cancelled', { jobId: id, trackIndex: job.trackIndex, trackTitle: job.title });
      } else {
        broadcastEvent('media_cancelled', { jobId: id, title: job.title });
      }
      cancelledCount++;
    }
  }

  if (jobId && activeJobs.has(jobId)) {
    cancelJob(jobId, activeJobs.get(jobId));
  } else {
    // Cancel all active running jobs
    for (const [id, job] of activeJobs.entries()) {
      cancelJob(id, job);
    }
  }

  notifyMac('Download Cancelled', 'Download was stopped.');
  return res.json({ success: true, message: 'Download cancelled successfully.', cancelledCount });
});

// Quick Download Endpoint (receives GET or POST from iPhone, Shortcuts, webhooks, anywhere)
app.all('/api/quick-download', async (req, res) => {
  const url = req.query.url || req.body?.url;
  const requestedFormat = req.query.format || req.body?.format || 'mp3';
  const requestedQuality = req.query.quality || req.body?.quality || 'lossless';
  const requestedCodec = req.query.codec || req.body?.codec || 'alac';

  if (!url || typeof url !== 'string' || !isSafeUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid, safe HTTP/HTTPS URL via ?url=' });
  }

  try {
    const trimmed = url.trim();

    // If it's Apple Music, use official album parser
    if (trimmed.includes('music.apple.com')) {
      const album = await fetchAppleMusicAlbum(trimmed);
      const jobId = startAlbumDownload(album, 'remote', requestedQuality, requestedCodec);
      return res.json({
        success: true,
        jobId,
        platform: 'Apple Music',
        quality: requestedQuality,
        codec: requestedCodec,
        message: `Downloading "${album.title}" (${requestedQuality.toUpperCase()}) to Mac Finder.`,
        title: album.title,
        artist: album.artist,
        artwork: album.artwork
      });
    }

    // Inspect universal link from any platform
    const media = await inspectUniversalUrl(trimmed);

    if (media.type === 'album' || media.type === 'playlist') {
      const jobId = startAlbumDownload(media, 'remote', requestedQuality, requestedCodec);
      return res.json({
        success: true,
        jobId,
        platform: media.platformName,
        quality: requestedQuality,
        codec: requestedCodec,
        message: `Downloading ${media.type} "${media.title}" (${media.totalTracks} songs, ${requestedQuality.toUpperCase()}) to Mac Finder.`,
        title: media.title,
        artist: media.artist,
        artwork: media.artwork
      });
    }

    // Single item (track, video, reel)
    const formatToUse = (media.type === 'video' || media.type === 'reel') ? 'mp4' : requestedFormat;
    const jobId = `quick_${Date.now()}`;

    res.json({
      success: true,
      jobId,
      platform: media.platformName,
      quality: requestedQuality,
      codec: requestedCodec,
      message: `Downloading "${media.title}" (${formatToUse === 'mp4' ? 'MP4' : requestedQuality.toUpperCase()}) to Mac Finder.`,
      title: media.title,
      artist: media.artist,
      artwork: media.artwork
    });

    (async () => {
      try {
        notifyMac('Remote Download', `"${media.title}" • ${formatToUse === 'mp4' ? 'MP4' : requestedQuality.toUpperCase()}`);
        const finalPath = await downloadUniversalMedia(media, formatToUse, DOWNLOADS_DIR, () => {}, null, requestedQuality, requestedCodec);
        notifyMac('Download Complete ✓', `Saved "${media.title}" to Finder!`);
        exec(`open "${path.dirname(finalPath.path || finalPath)}"`, () => {});
      } catch (err) {
        console.error('Remote download failed:', err.message);
        notifyMac('Remote Download Failed', `Could not download "${media.title}"`);
      }
    })();
  } catch (err) {
    console.error('Quick download error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to start quick download.' });
  }
});

// Single Track Download
app.post('/api/download-track', async (req, res) => {
  const { track, album, trackIndex, quality = 'lossless', codec = 'alac' } = req.body;
  if (!track || !album) {
    return res.status(400).json({ error: 'Missing track or album data.' });
  }

  const jobId = `track_${Date.now()}_${track.id || trackIndex || 'job'}`;
  const job = {
    id: jobId,
    type: 'track',
    status: 'downloading',
    title: track.title,
    trackIndex,
    quality,
    codec,
    cancelled: false,
    currentProc: null,
    tempFiles: new Set()
  };
  activeJobs.set(jobId, job);

  res.json({ success: true, jobId, message: 'Track download started.' });

  (async () => {
    try {
      const displayLabel = quality === 'hires' ? 'Hi-Res Lossless' : (quality === 'lossless' ? 'Lossless' : 'High Quality');
      notifyMac('Starting Download', `"${track.title}" • ${displayLabel}`);
      broadcastEvent('track_started', {
        jobId,
        type: 'track_start',
        trackId: track.id,
        trackIndex,
        trackTitle: track.title,
        artist: track.artist || album.artist,
        quality,
        codec
      });

      const safeArtist = (album.artist || track.artist || 'Unknown Artist').replace(/[\\/:*?"<>|]/g, '_').trim();
      const safeAlbum = (album.title || track.title || 'Unknown Album').replace(/[\\/:*?"<>|]/g, '_').trim();
      const albumDir = path.join(DOWNLOADS_DIR, safeArtist, safeAlbum);
      await fs.promises.mkdir(albumDir, { recursive: true });

      const coverPath = path.join(albumDir, 'cover.jpg');
      let coverBuffer = null;
      if (fs.existsSync(coverPath)) {
        coverBuffer = await fs.promises.readFile(coverPath);
      } else if (album.artwork) {
        coverBuffer = await downloadCoverArt(album.artwork, coverPath);
      }

      const result = await downloadSingleTrack(track, album, albumDir, coverBuffer, progress => {
        broadcastEvent('track_progress', {
          jobId,
          type: 'track_progress',
          trackId: track.id,
          trackIndex,
          trackTitle: track.title,
          quality,
          codec,
          ...progress
        });
      }, job, quality, codec);

      if (job.cancelled) {
        broadcastEvent('track_cancelled', { jobId, trackId: track.id, trackIndex, trackTitle: track.title });
        return;
      }

      job.status = 'completed';
      broadcastEvent('track_completed', {
        jobId,
        type: 'track_complete',
        trackId: track.id,
        trackIndex,
        trackTitle: track.title,
        fileSize: result.fileSize,
        path: result.path,
        quality: result.quality || quality,
        codec: result.codec || codec,
        format: result.format
      });

      notifyMac('Apple Music Downloader', `✓ Saved "${track.title}" (${result.fileSize}) [${(result.quality || quality).toUpperCase()}] to Finder!`);
      exec(`open "${albumDir}"`, () => {});
    } catch (err) {
      if (err.message === 'DOWNLOAD_CANCELLED' || job.cancelled) {
        job.status = 'cancelled';
        broadcastEvent('track_cancelled', { jobId, trackId: track.id, trackIndex, trackTitle: track.title });
        notifyMac('Download Cancelled', `Cancelled: "${track.title}"`);
        return;
      }
      console.error('Download single track failed:', err);
      job.status = 'failed';
      broadcastEvent('track_error', {
        jobId,
        trackId: track.id,
        trackIndex,
        trackTitle: track.title,
        error: err.message
      });
      notifyMac('Download Failed', `Could not download: "${track.title}"`);
    } finally {
      setTimeout(() => activeJobs.delete(jobId), 30000);
    }
  })();
});
// Video Search: search movies, web series, and video parts
app.post('/api/search-videos', async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Please enter a search query or URL.' });
  }

  try {
    const results = await searchVideoSeries(query.trim());
    res.json({ success: true, results });
  } catch (err) {
    console.error('Video search error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to search video parts.' });
  }
});

// Download single video part
app.post('/api/download-video-part', (req, res) => {
  const { video, seriesName } = req.body;
  if (!video || !video.url) {
    return res.status(400).json({ error: 'Missing video data.' });
  }

  const jobId = `video_${Date.now()}_${video.id || 'job'}`;
  res.json({ success: true, jobId, message: 'Video download started.' });

  (async () => {
    try {
      notifyMac('Downloading Video', `Starting "${video.title}"...`);
      broadcastEvent('video_started', { jobId, videoId: video.id, title: video.title });

      const finalPath = await downloadVideoPart(video, seriesName, DOWNLOADS_DIR, progress => {
        broadcastEvent('video_progress', { jobId, videoId: video.id, title: video.title, ...progress });
      });

      broadcastEvent('video_completed', { jobId, videoId: video.id, title: video.title, path: finalPath });
      notifyMac('Video Downloaded', `✓ Saved "${video.title}" to Finder!`);

      exec(`open "${path.dirname(finalPath)}"`, () => {});
    } catch (err) {
      console.error('Download video part failed:', err.message);
      broadcastEvent('video_failed', { jobId, videoId: video.id, title: video.title, error: err.message });
      notifyMac('Video Error', `Could not download: "${video.title}"`);
    }
  })();
});

// Download all video parts
app.post('/api/download-all-video-parts', (req, res) => {
  const { videos, seriesName } = req.body;
  if (!videos || !Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: 'Missing videos array.' });
  }

  const jobId = `videos_batch_${Date.now()}`;
  res.json({ success: true, jobId, message: `Batch download of ${videos.length} parts started.` });

  (async () => {
    let lastDir = null;
    notifyMac('Series Download', `Starting ${videos.length} parts of "${seriesName || 'Series'}"...`);

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      try {
        broadcastEvent('video_started', { jobId, videoId: v.id, title: v.title, partIndex: i, totalParts: videos.length });
        const finalPath = await downloadVideoPart(v, seriesName, DOWNLOADS_DIR, progress => {
          broadcastEvent('video_progress', { jobId, videoId: v.id, title: v.title, partIndex: i, totalParts: videos.length, ...progress });
        });
        lastDir = path.dirname(finalPath);
        broadcastEvent('video_completed', { jobId, videoId: v.id, title: v.title, partIndex: i, totalParts: videos.length });
      } catch (err) {
        broadcastEvent('video_failed', { jobId, videoId: v.id, title: v.title, error: err.message });
      }
    }

    if (lastDir) {
      exec(`open "${lastDir}"`, () => {});
    }
    notifyMac('Series Complete', `✓ Downloaded all parts of "${seriesName || 'Series'}" to Finder!`);
  })();
});

// Get downloaded offline library
app.get('/api/library', async (req, res) => {
  try {
    const library = await getDownloadedLibrary(DOWNLOADS_DIR);
    res.json(library);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read library.' });
  }
});

// Stream audio file with HTTP Range support
app.get('/api/stream', (req, res) => {
  const { artist, album, file } = req.query;
  if (!artist || !album || !file) {
    return res.status(400).send('Missing query parameters.');
  }

  const safeArtist = path.basename(artist);
  const safeAlbum = path.basename(album);
  const safeFile = path.basename(file);
  let filePath = path.join(DOWNLOADS_DIR, safeArtist, safeAlbum, safeFile);
  if (!fs.existsSync(filePath)) {
    const directPath = path.join(DOWNLOADS_DIR, safeArtist, safeFile);
    if (fs.existsSync(directPath)) filePath = directPath;
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Audio file not found.');
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;

  const ext = path.extname(safeFile).toLowerCase();
  let contentType = 'audio/mpeg';
  if (ext === '.m4a') contentType = 'audio/mp4';
  else if (ext === '.flac') contentType = 'audio/flac';
  else if (ext === '.aac') contentType = 'audio/aac';
  else if (ext === '.wav') contentType = 'audio/wav';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const partialStart = parts[0];
    const partialEnd = parts[1];

    const start = parseInt(partialStart, 10);
    const end = partialEnd ? parseInt(partialEnd, 10) : total - 1;
    const chunksize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Serve album cover image
app.get('/api/cover', (req, res) => {
  const { artist, album } = req.query;
  if (!artist || !album) return res.status(400).send('Missing params.');

  const safeArtist = path.basename(artist);
  const safeAlbum = path.basename(album);
  let coverPath = path.join(DOWNLOADS_DIR, safeArtist, safeAlbum, 'cover.jpg');
  if (!fs.existsSync(coverPath)) {
    const directCover = path.join(DOWNLOADS_DIR, safeArtist, 'cover.jpg');
    if (fs.existsSync(directCover)) coverPath = directCover;
  }

  if (fs.existsSync(coverPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(coverPath).pipe(res);
  } else {
    res.status(404).send('Cover not found.');
  }
});

// Serve lyrics
app.get('/api/lyrics', (req, res) => {
  const { artist, album, file } = req.query;
  if (!artist || !album || !file) return res.status(400).send('Missing params.');

  const safeArtist = path.basename(artist);
  const safeAlbum = path.basename(album);
  const safeFile = path.basename(file);
  let lrcPath = path.join(DOWNLOADS_DIR, safeArtist, safeAlbum, safeFile);
  if (!fs.existsSync(lrcPath)) {
    const directLrc = path.join(DOWNLOADS_DIR, safeArtist, safeFile);
    if (fs.existsSync(directLrc)) lrcPath = directLrc;
  }

  if (fs.existsSync(lrcPath)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    fs.createReadStream(lrcPath).pipe(res);
  } else {
    res.status(404).send('Lyrics not found.');
  }
});

// Open downloads folder in macOS Finder
app.post('/api/open-folder', (req, res) => {
  const { artist, album } = req.body || {};
  let targetPath = DOWNLOADS_DIR;

  if (artist && album) {
    const specificPath = path.join(DOWNLOADS_DIR, path.basename(artist), path.basename(album));
    if (fs.existsSync(specificPath)) {
      targetPath = specificPath;
    }
  }

  exec(`open "${targetPath}"`, err => {
    if (err) {
      return res.status(500).json({ error: 'Could not open folder in Finder.' });
    }
    res.json({ success: true, path: targetPath });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵 Apple Music Offline Downloader & Player running at:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${getLocalIp()}:${PORT}\n`);
});

module.exports = app;
