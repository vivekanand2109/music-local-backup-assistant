const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const NodeID3 = require('node-id3');

const YTDLP_PATH = path.join(__dirname, '../bin/yt-dlp');
let FFMPEG_PATH;
try {
  FFMPEG_PATH = require('ffmpeg-static');
} catch (e) {
  FFMPEG_PATH = 'ffmpeg';
}

function sanitizeFilename(name) {
  return (name || 'track')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
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

async function fetchLyrics(artist, title, album, durationSeconds = 0) {
  try {
    const params = new URLSearchParams({
      artist_name: artist,
      track_name: title,
      album_name: album || ''
    });
    if (durationSeconds > 0) {
      params.append('duration', Math.round(durationSeconds));
    }
    const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: { 'User-Agent': 'AppleMusicDownloader/1.0' }
    });
    if (res.ok) {
      const data = await res.json();
      return {
        plainLyrics: data.plainLyrics || null,
        syncedLyrics: data.syncedLyrics || null
      };
    }
  } catch (err) {
    // Lyrics fetch error is non-fatal
  }
  return { plainLyrics: null, syncedLyrics: null };
}

async function downloadCoverArt(artworkUrl, targetPath) {
  if (!artworkUrl) return null;
  try {
    const res = await fetch(artworkUrl);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.promises.writeFile(targetPath, buffer);
    return buffer;
  } catch (e) {
    return null;
  }
}

async function tagAudioWithFfmpeg(filePath, tags, coverPath, ext) {
  const tempTagged = filePath + '.tagged.' + ext;
  const args = ['-y', '-i', filePath];

  if (coverPath && fs.existsSync(coverPath)) {
    args.push('-i', coverPath, '-map', '0:a', '-map', '1:v', '-c:a', 'copy', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
  } else {
    args.push('-map', '0', '-c', 'copy');
  }

  if (tags.title) args.push('-metadata', `title=${tags.title}`);
  if (tags.artist) args.push('-metadata', `artist=${tags.artist}`);
  if (tags.album) args.push('-metadata', `album=${tags.album}`);
  if (tags.performerInfo) args.push('-metadata', `album_artist=${tags.performerInfo}`);
  if (tags.year) args.push('-metadata', `date=${tags.year}`);
  if (tags.genre) args.push('-metadata', `genre=${tags.genre}`);
  if (tags.trackNumber) args.push('-metadata', `track=${tags.trackNumber}`);
  if (tags.partOfSet) args.push('-metadata', `disc=${tags.partOfSet}`);
  if (tags.unsynchronisedLyrics && tags.unsynchronisedLyrics.text) {
    args.push('-metadata', `lyrics=${tags.unsynchronisedLyrics.text}`);
  }

  args.push(tempTagged);

  return new Promise((resolve) => {
    const p = spawn(FFMPEG_PATH, args);
    p.on('close', code => {
      if (code === 0 && fs.existsSync(tempTagged)) {
        try {
          fs.unlinkSync(filePath);
          fs.renameSync(tempTagged, filePath);
        } catch (e) {}
      } else {
        try { if (fs.existsSync(tempTagged)) fs.unlinkSync(tempTagged); } catch (e) {}
      }
      resolve();
    });
    p.on('error', () => resolve());
  });
}

function downloadAudioWithYtDlp(searchQuery, outputTemplate, onProgress, job, quality = 'lossless', codec = 'alac') {
  return new Promise((resolve, reject) => {
    if (job && job.cancelled) {
      return reject(new Error('DOWNLOAD_CANCELLED'));
    }

    const normQuality = (quality || 'lossless').toLowerCase();
    const normCodec = (codec || 'alac').toLowerCase();

    let ytDlpFormat = 'alac';
    const postProcessorArgs = [];

    if (normQuality === 'hires') {
      if (normCodec === 'flac') {
        ytDlpFormat = 'flac';
        postProcessorArgs.push('ExtractAudio:-c:a flac -sample_fmt s32 -ar 96000');
      } else {
        ytDlpFormat = 'alac';
        postProcessorArgs.push('ExtractAudio:-c:a alac -sample_fmt s32p -ar 96000');
      }
    } else if (normQuality === 'lossless') {
      if (normCodec === 'flac') {
        ytDlpFormat = 'flac';
        postProcessorArgs.push('ExtractAudio:-c:a flac -sample_fmt s16 -ar 48000');
      } else {
        ytDlpFormat = 'alac';
        postProcessorArgs.push('ExtractAudio:-c:a alac -sample_fmt s16p -ar 48000');
      }
    } else {
      ytDlpFormat = 'mp3';
      postProcessorArgs.push('ExtractAudio:-c:a libmp3lame -b:a 320k');
    }

    const args = [
      '--js-runtimes', `node:${process.execPath}`,
      '--ffmpeg-location', FFMPEG_PATH,
      '-x',
      '--audio-format', ytDlpFormat,
      '--audio-quality', '0',
      '--no-playlist',
      '--no-warnings',
      '--newline'
    ];

    if (postProcessorArgs.length > 0) {
      args.push('--postprocessor-args', postProcessorArgs.join(' '));
    }

    args.push('-o', outputTemplate, searchQuery);

    const proc = spawn(YTDLP_PATH, args);
    if (job) job.currentProc = proc;

    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', data => {
      const text = data.toString();
      stdoutData += text;
      const match = text.match(/\[download\]\s+([\d.]+)%\s+of\s+(~?\s*[\d.]+\w+)(?:\s+at\s+([\d.]+\w+\/s))?(?:\s+ETA\s+([\d:]+))?/);
      if (match && onProgress) {
        onProgress({
          percent: parseFloat(match[1]),
          totalSize: match[2].replace(/\s+/g, ''),
          speed: match[3] || null,
          eta: match[4] || null
        });
      } else {
        const simple = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (simple && onProgress) {
          onProgress({ percent: parseFloat(simple[1]) });
        }
      }
    });

    proc.stderr.on('data', data => {
      stderrData += data.toString();
    });

    proc.on('close', code => {
      if (job && job.currentProc === proc) job.currentProc = null;
      if (job && job.cancelled) {
        return reject(new Error('DOWNLOAD_CANCELLED'));
      }
      if (code === 0) {
        resolve(stdoutData);
      } else {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderrData || stdoutData}`));
      }
    });

    proc.on('error', err => {
      if (job && job.currentProc === proc) job.currentProc = null;
      reject(err);
    });
  });
}

async function downloadSingleTrack(track, album, outputDir, coverBuffer, onProgress, job, quality = 'lossless', codec = 'alac') {
  if (job && job.cancelled) throw new Error('DOWNLOAD_CANCELLED');

  const normQuality = (quality || 'lossless').toLowerCase();
  const normCodec = (codec || 'alac').toLowerCase();

  let ext = 'm4a';
  if (normCodec === 'flac') ext = 'flac';
  else if (normCodec === 'mp3' || normQuality === 'high') ext = 'mp3';
  else if (normCodec === 'alac' || normQuality === 'lossless' || normQuality === 'hires') ext = 'm4a';

  const padNum = String(track.trackNumber || 1).padStart(2, '0');
  const safeTitle = sanitizeFilename(track.title);
  const finalFilename = `${safeTitle}.${ext}`;
  const finalPath = path.join(outputDir, finalFilename);

  // If already downloaded, skip re-downloading
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 100000) {
    const stat = fs.statSync(finalPath);
    const fileSize = formatBytes(stat.size);
    if (onProgress) onProgress({
      status: 'already_downloaded',
      percent: 100,
      file: finalFilename,
      fileSize,
      sizeBytes: stat.size,
      quality: normQuality,
      codec: normCodec,
      format: ext.toUpperCase()
    });
    return { path: finalPath, fileSize, sizeBytes: stat.size, quality: normQuality, codec: normCodec, format: ext.toUpperCase() };
  }

  const tempTemplate = path.join(outputDir, `.temp_${padNum}_%(id)s.%(ext)s`);

  if (onProgress) onProgress({ status: 'searching', percent: 5 });

  // Preferred search queries
  const cleanTrackTitle = track.title.replace(/\([^)]*version[^)]*\)/gi, '').trim();
  const searchCandidates = [];
  if (track.url && (track.url.includes('youtube.com') || track.url.includes('youtu.be') || track.url.includes('soundcloud.com'))) {
    searchCandidates.push(track.url);
  }
  if (track.searchQuery) {
    searchCandidates.push(`ytsearch1:${track.searchQuery}`);
  }
  searchCandidates.push(`ytsearch1:${track.artist} - ${track.title} official audio`);
  searchCandidates.push(`ytsearch1:${track.artist} - ${cleanTrackTitle} audio`);
  searchCandidates.push(`ytsearch1:${track.artist} ${track.title}`);

  let downloadedTempFile = null;

  for (const query of searchCandidates) {
    if (job && job.cancelled) throw new Error('DOWNLOAD_CANCELLED');
    try {
      if (onProgress) onProgress({ status: 'downloading', percent: 10 });
      await downloadAudioWithYtDlp(query, tempTemplate, prog => {
        if (onProgress) {
          const rawPct = prog.percent || 0;
          const scaled = 10 + Math.round((rawPct / 100) * 75);
          onProgress({
            status: 'downloading',
            percent: scaled,
            totalSize: prog.totalSize || null,
            speed: prog.speed || null,
            eta: prog.eta || null,
            quality: normQuality,
            codec: normCodec
          });
        }
      }, job, normQuality, normCodec);

      // Find the generated temp audio file (.m4a, .flac, or .mp3)
      const files = await fs.promises.readdir(outputDir);
      const matched = files.find(f => f.startsWith(`.temp_${padNum}_`) && (f.endsWith(`.${ext}`) || f.endsWith('.m4a') || f.endsWith('.flac') || f.endsWith('.mp3')));
      if (matched) {
        downloadedTempFile = path.join(outputDir, matched);
        if (job && job.tempFiles) job.tempFiles.add(downloadedTempFile);
        break;
      }
    } catch (e) {
      if (e.message === 'DOWNLOAD_CANCELLED' || (job && job.cancelled)) {
        throw new Error('DOWNLOAD_CANCELLED');
      }
      // try next candidate
    }
  }

  if (job && job.cancelled) {
    if (downloadedTempFile && fs.existsSync(downloadedTempFile)) {
      try { fs.unlinkSync(downloadedTempFile); } catch (e) {}
    }
    throw new Error('DOWNLOAD_CANCELLED');
  }

  if (!downloadedTempFile || !fs.existsSync(downloadedTempFile)) {
    throw new Error(`Failed to download audio for track: ${track.title}`);
  }

  // Tagging status
  if (onProgress) onProgress({ status: 'tagging', percent: 90 });

  // Fetch lyrics
  const durationSec = (track.durationMs || 0) / 1000;
  const albumTitle = album ? album.title : track.title;
  const albumArtist = album ? album.artist : track.artist;
  const lyrics = await fetchLyrics(track.artist, track.title, albumTitle, durationSec);

  if (lyrics.syncedLyrics) {
    const lrcPath = path.join(outputDir, `${safeTitle}.lrc`);
    await fs.promises.writeFile(lrcPath, lyrics.syncedLyrics, 'utf8').catch(() => {});
  }

  // Write tags
  const totalCount = (album && album.tracks && album.tracks.length) || (track.trackNumber || 1);
  const trackNumStr = track.trackNumber ? `${track.trackNumber}/${totalCount}` : '1/1';
  const tags = {
    title: track.title,
    artist: track.artist || albumArtist,
    album: albumTitle,
    performerInfo: albumArtist,
    year: album && album.year ? String(album.year) : undefined,
    genre: (album && album.genre) || 'Music',
    trackNumber: trackNumStr,
    partOfSet: `${track.discNumber || 1}/1`
  };

  if (lyrics.plainLyrics) {
    tags.unsynchronisedLyrics = {
      language: 'eng',
      text: lyrics.plainLyrics
    };
  }

  if (coverBuffer && coverBuffer.length > 0) {
    tags.image = {
      mime: 'image/jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'Album Art',
      imageBuffer: coverBuffer
    };
  }

  const coverPath = path.join(outputDir, 'cover.jpg');

  if (ext === 'mp3') {
    try {
      await NodeID3.write(tags, downloadedTempFile);
    } catch (err) {
      console.warn('ID3 tag write warning:', err.message);
    }
  } else {
    try {
      await tagAudioWithFfmpeg(downloadedTempFile, tags, coverPath, ext);
    } catch (err) {
      console.warn('FFmpeg tag write warning:', err.message);
    }
  }

  // Rename to final filename
  await fs.promises.rename(downloadedTempFile, finalPath);
  if (job && job.tempFiles) job.tempFiles.delete(downloadedTempFile);

  const stat = await fs.promises.stat(finalPath);
  const fileSize = formatBytes(stat.size);

  if (onProgress) onProgress({
    status: 'done',
    percent: 100,
    file: finalFilename,
    fileSize,
    sizeBytes: stat.size,
    quality: normQuality,
    codec: normCodec,
    format: ext.toUpperCase()
  });
  return { path: finalPath, fileSize, sizeBytes: stat.size, quality: normQuality, codec: normCodec, format: ext.toUpperCase() };
}

async function downloadAlbum(album, baseOutputDir, onAlbumProgress, job, quality = 'lossless', codec = 'alac') {
  if (job && job.cancelled) throw new Error('DOWNLOAD_CANCELLED');

  const safeArtist = sanitizeFilename(album.artist);
  const safeAlbum = sanitizeFilename(album.title);
  const albumDir = path.join(baseOutputDir, safeArtist, safeAlbum);

  await fs.promises.mkdir(albumDir, { recursive: true });

  const coverPath = path.join(albumDir, 'cover.jpg');
  let coverBuffer = null;

  if (fs.existsSync(coverPath)) {
    coverBuffer = await fs.promises.readFile(coverPath);
  } else if (album.artwork) {
    coverBuffer = await downloadCoverArt(album.artwork, coverPath);
  }

  const results = [];
  const total = album.tracks.length;

  for (let i = 0; i < total; i++) {
    if (job && job.cancelled) {
      break;
    }
    const track = album.tracks[i];
    try {
      if (onAlbumProgress) {
        onAlbumProgress({
          type: 'track_start',
          trackIndex: i,
          trackNumber: track.trackNumber,
          trackTitle: track.title,
          totalTracks: total,
          quality,
          codec
        });
      }

      const res = await downloadSingleTrack(
        track,
        album,
        albumDir,
        coverBuffer,
        progress => {
          if (onAlbumProgress) {
            onAlbumProgress({
              type: 'track_progress',
              trackIndex: i,
              trackNumber: track.trackNumber,
              trackTitle: track.title,
              totalTracks: total,
              quality,
              codec,
              ...progress
            });
          }
        },
        job,
        quality,
        codec
      );

      results.push({ track: track.title, success: true, path: res.path, fileSize: res.fileSize, sizeBytes: res.sizeBytes });

      if (onAlbumProgress) {
        onAlbumProgress({
          type: 'track_complete',
          trackIndex: i,
          trackNumber: track.trackNumber,
          trackTitle: track.title,
          totalTracks: total,
          fileSize: res.fileSize,
          completedTracks: results.filter(r => r.success).length,
          quality,
          codec
        });
      }
    } catch (err) {
      if (err.message === 'DOWNLOAD_CANCELLED' || (job && job.cancelled)) {
        break;
      }
      results.push({ track: track.title, success: false, error: err.message });
      if (onAlbumProgress) {
        onAlbumProgress({
          type: 'track_error',
          trackIndex: i,
          trackNumber: track.trackNumber,
          trackTitle: track.title,
          error: err.message
        });
      }
    }
  }

  let totalBytes = 0;
  for (const r of results) {
    if (r.success && r.sizeBytes) totalBytes += r.sizeBytes;
  }

  return {
    albumDir,
    coverPath,
    total,
    downloaded: results.filter(r => r.success).length,
    totalSizeFormatted: formatBytes(totalBytes),
    totalBytes,
    results
  };
}

function downloadVideoWithYtDlp(url, outputTemplate, onProgress, job) {
  return new Promise((resolve, reject) => {
    if (job && job.cancelled) {
      return reject(new Error('DOWNLOAD_CANCELLED'));
    }

    const args = [
      '--js-runtimes', `node:${process.execPath}`,
      '--ffmpeg-location', FFMPEG_PATH,
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '-o', outputTemplate,
      url
    ];

    const proc = spawn(YTDLP_PATH, args);
    if (job) job.currentProc = proc;

    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', data => {
      const text = data.toString();
      stdoutData += text;
      const match = text.match(/\[download\]\s+([\d.]+)%\s+of\s+(~?\s*[\d.]+\w+)(?:\s+at\s+([\d.]+\w+\/s))?(?:\s+ETA\s+([\d:]+))?/);
      if (match && onProgress) {
        onProgress({
          percent: parseFloat(match[1]),
          totalSize: match[2].replace(/\s+/g, ''),
          speed: match[3] || null,
          eta: match[4] || null
        });
      } else {
        const simple = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (simple && onProgress) {
          onProgress({ percent: parseFloat(simple[1]) });
        }
      }
    });

    proc.stderr.on('data', data => {
      stderrData += data.toString();
    });

    proc.on('close', code => {
      if (job && job.currentProc === proc) job.currentProc = null;
      if (job && job.cancelled) {
        return reject(new Error('DOWNLOAD_CANCELLED'));
      }
      if (code === 0) {
        resolve(stdoutData);
      } else {
        reject(new Error(`Video download failed (code ${code}): ${stderrData || stdoutData}`));
      }
    });

    proc.on('error', err => {
      if (job && job.currentProc === proc) job.currentProc = null;
      reject(err);
    });
  });
}

async function downloadUniversalMedia(item, format = 'mp3', baseOutputDir, onProgress, job, quality = 'lossless', codec = 'alac') {
  if (job && job.cancelled) throw new Error('DOWNLOAD_CANCELLED');
  const safeTitle = sanitizeFilename(item.title);
  const safeArtist = sanitizeFilename(item.artist || 'Downloads');

  if (format === 'mp4') {
    const videoDir = path.join(baseOutputDir, 'Videos');
    await fs.promises.mkdir(videoDir, { recursive: true });

    const finalPath = path.join(videoDir, `${safeTitle}.mp4`);
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 200000) {
      const stat = fs.statSync(finalPath);
      const fileSize = formatBytes(stat.size);
      if (onProgress) onProgress({ status: 'done', percent: 100, file: finalPath, fileSize, sizeBytes: stat.size, format: 'MP4' });
      return { path: finalPath, fileSize, sizeBytes: stat.size, format: 'MP4' };
    }

    const tempTemplate = path.join(videoDir, `.temp_${Date.now()}_%(id)s.%(ext)s`);
    if (onProgress) onProgress({ status: 'downloading', percent: 5 });

    await downloadVideoWithYtDlp(item.url, tempTemplate, prog => {
      if (onProgress) {
        if (typeof prog === 'object') {
          onProgress({ status: 'downloading', ...prog });
        } else {
          onProgress({ status: 'downloading', percent: prog });
        }
      }
    }, job);

    if (job && job.cancelled) throw new Error('DOWNLOAD_CANCELLED');

    const files = await fs.promises.readdir(videoDir);
    const matched = files.find(f => f.startsWith(`.temp_`) && f.endsWith('.mp4'));
    if (!matched) throw new Error('Video download completed but output file not found.');

    const tempFile = path.join(videoDir, matched);
    if (job && job.tempFiles) job.tempFiles.add(tempFile);

    if (job && job.cancelled) {
      try { fs.unlinkSync(tempFile); } catch (e) {}
      throw new Error('DOWNLOAD_CANCELLED');
    }

    await fs.promises.rename(tempFile, finalPath);
    if (job && job.tempFiles) job.tempFiles.delete(tempFile);

    const stat = await fs.promises.stat(finalPath);
    const fileSize = formatBytes(stat.size);

    if (onProgress) onProgress({ status: 'done', percent: 100, file: finalPath, fileSize, sizeBytes: stat.size, format: 'MP4' });
    return { path: finalPath, fileSize, sizeBytes: stat.size, format: 'MP4' };
  }

  // Audio download (Lossless ALAC / FLAC / MP3)
  const normQuality = (quality || (format === 'hires' ? 'hires' : (format === 'lossless' ? 'lossless' : 'high'))).toLowerCase();
  const normCodec = (codec || (format === 'flac' ? 'flac' : (format === 'mp3' ? 'mp3' : 'alac'))).toLowerCase();

  let ext = 'm4a';
  if (normCodec === 'flac' || format === 'flac') ext = 'flac';
  else if (normCodec === 'mp3' || normQuality === 'high' || format === 'mp3') ext = 'mp3';
  else if (normCodec === 'alac' || normQuality === 'lossless' || normQuality === 'hires') ext = 'm4a';

  const targetDir = path.join(baseOutputDir, safeArtist);
  await fs.promises.mkdir(targetDir, { recursive: true });

  const finalPath = path.join(targetDir, `${safeTitle}.${ext}`);
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 100000) {
    const stat = fs.statSync(finalPath);
    const fileSize = formatBytes(stat.size);
    if (onProgress) onProgress({
      status: 'done',
      percent: 100,
      file: finalPath,
      fileSize,
      sizeBytes: stat.size,
      quality: normQuality,
      codec: normCodec,
      format: ext.toUpperCase()
    });
    return { path: finalPath, fileSize, sizeBytes: stat.size, quality: normQuality, codec: normCodec, format: ext.toUpperCase() };
  }

  const tempTemplate = path.join(targetDir, `.temp_${Date.now()}_%(id)s.%(ext)s`);

  if (onProgress) onProgress({ status: 'downloading', percent: 10, quality: normQuality, codec: normCodec });

  const candidates = [];
  if (item.url && !item.url.includes('spotify.com') && !item.url.includes('apple.com')) {
    candidates.push(item.url);
  }
  if (item.searchQuery) {
    candidates.push(`ytsearch1:${item.searchQuery}`);
  }
  candidates.push(`ytsearch1:${item.artist} - ${item.title} audio`);
  candidates.push(`ytsearch1:${item.artist} ${item.title}`);

  let downloadedTempFile = null;

  for (const query of candidates) {
    if (job && job.cancelled) throw new Error('DOWNLOAD_CANCELLED');
    try {
      await downloadAudioWithYtDlp(query, tempTemplate, prog => {
        if (onProgress) {
          const rawPct = prog.percent || 0;
          const scaled = 10 + Math.round((rawPct / 100) * 75);
          onProgress({
            status: 'downloading',
            percent: scaled,
            totalSize: prog.totalSize || null,
            speed: prog.speed || null,
            eta: prog.eta || null,
            quality: normQuality,
            codec: normCodec
          });
        }
      }, job, normQuality, normCodec);

      const files = await fs.promises.readdir(targetDir);
      const matched = files.find(f => f.startsWith(`.temp_`) && (f.endsWith(`.${ext}`) || f.endsWith('.m4a') || f.endsWith('.flac') || f.endsWith('.mp3')));
      if (matched) {
        downloadedTempFile = path.join(targetDir, matched);
        if (job && job.tempFiles) job.tempFiles.add(downloadedTempFile);
        break;
      }
    } catch (e) {
      if (e.message === 'DOWNLOAD_CANCELLED' || (job && job.cancelled)) {
        throw new Error('DOWNLOAD_CANCELLED');
      }
    }
  }

  if (job && job.cancelled) {
    if (downloadedTempFile && fs.existsSync(downloadedTempFile)) {
      try { fs.unlinkSync(downloadedTempFile); } catch (e) {}
    }
    throw new Error('DOWNLOAD_CANCELLED');
  }

  if (!downloadedTempFile || !fs.existsSync(downloadedTempFile)) {
    throw new Error(`Could not download audio for: ${item.title}`);
  }

  if (onProgress) onProgress({ status: 'tagging', percent: 90 });

  let coverBuffer = null;
  const coverPath = path.join(targetDir, 'cover.jpg');
  if (item.artwork) {
    coverBuffer = await downloadCoverArt(item.artwork, coverPath);
  }

  const durationSec = (item.durationMs || 0) / 1000;
  const lyrics = await fetchLyrics(item.artist, item.title, item.album || item.title, durationSec);

  if (lyrics.syncedLyrics) {
    const lrcPath = path.join(targetDir, `${safeTitle}.lrc`);
    await fs.promises.writeFile(lrcPath, lyrics.syncedLyrics, 'utf8').catch(() => {});
  }

  const tags = {
    title: item.title,
    artist: item.artist,
    album: item.album || item.title,
    performerInfo: item.artist,
    genre: item.genre || 'Music'
  };

  if (lyrics.plainLyrics) {
    tags.unsynchronisedLyrics = {
      language: 'eng',
      text: lyrics.plainLyrics
    };
  }

  if (coverBuffer && coverBuffer.length > 0) {
    tags.image = {
      mime: 'image/jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'Cover Art',
      imageBuffer: coverBuffer
    };
  }

  if (ext === 'mp3') {
    try {
      await NodeID3.write(tags, downloadedTempFile);
    } catch (err) {
      console.warn('ID3 tag write warning:', err.message);
    }
  } else {
    try {
      await tagAudioWithFfmpeg(downloadedTempFile, tags, coverPath, ext);
    } catch (err) {
      console.warn('FFmpeg tag write warning:', err.message);
    }
  }

  await fs.promises.rename(downloadedTempFile, finalPath);
  if (job && job.tempFiles) job.tempFiles.delete(downloadedTempFile);

  const stat = await fs.promises.stat(finalPath);
  const fileSize = formatBytes(stat.size);

  if (onProgress) onProgress({
    status: 'done',
    percent: 100,
    file: finalPath,
    fileSize,
    sizeBytes: stat.size,
    quality: normQuality,
    codec: normCodec,
    format: ext.toUpperCase()
  });
  return { path: finalPath, fileSize, sizeBytes: stat.size, quality: normQuality, codec: normCodec, format: ext.toUpperCase() };
}

module.exports = {
  downloadSingleTrack,
  downloadAlbum,
  downloadUniversalMedia,
  fetchLyrics,
  downloadCoverArt,
  formatBytes
};
