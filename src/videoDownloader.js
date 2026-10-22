const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const YTDLP_PATH = path.join(__dirname, '../bin/yt-dlp');
let FFMPEG_PATH;
try {
  FFMPEG_PATH = require('ffmpeg-static');
} catch (e) {
  FFMPEG_PATH = 'ffmpeg';
}

function sanitizeFilename(name) {
  return (name || 'video')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchVideoSeries(query, limit = 15) {
  return new Promise((resolve, reject) => {
    let searchTarget = query.trim();
    const isDirectUrl = searchTarget.startsWith('http://') || searchTarget.startsWith('https://');

    if (!isDirectUrl) {
      // Search for more items so we can filter out short trailers/teasers
      searchTarget = `ytsearch${limit * 2}:${searchTarget}`;
    }

    const args = [
      '--js-runtimes', `node:${process.execPath}`,
      '--flat-playlist',
      '--no-warnings',
      '-j',
      searchTarget
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
        return reject(new Error(errOutput || `Search exited with code ${code}`));
      }

      const lines = output.trim().split('\n').filter(Boolean);
      let results = [];

      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          const thumb = (item.thumbnails && item.thumbnails.length > 0)
            ? item.thumbnails[item.thumbnails.length - 1].url
            : null;

          const duration = item.duration || 0;
          const title = item.title || 'Untitled Part';
          const titleLower = title.toLowerCase();

          // Resolve proper URL (whether YouTube, direct host, or custom URL)
          let videoUrl = item.webpage_url || item.url;
          if (!videoUrl && item.id) {
            videoUrl = `https://www.youtube.com/watch?v=${item.id}`;
          } else if (!videoUrl && isDirectUrl) {
            videoUrl = searchTarget;
          }

          results.push({
            id: item.id || `video_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            title: title,
            url: videoUrl,
            duration: duration,
            durationString: item.duration_string || (duration > 0 ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : '--:--'),
            thumbnail: thumb,
            uploader: item.uploader || item.channel || '',
            viewCount: item.view_count || null,
            isDirectUrl: isDirectUrl
          });
        } catch (e) {
          // Ignore JSON parse errors for non-json lines
        }
      }

      // If it was a text search and user didn't specifically ask for a trailer,
      // sort full-length episodes (> 15 mins) first and demote short trailers
      if (!isDirectUrl && results.length > 0) {
        const queryLower = query.toLowerCase();
        const wantsTrailer = queryLower.includes('trailer') || queryLower.includes('teaser');

        if (!wantsTrailer) {
          // Separate full-length parts vs short clips
          const fullParts = results.filter(r => r.duration >= 600 || r.duration === 0);
          const shortClips = results.filter(r => r.duration > 0 && r.duration < 600);

          // If we have full parts, show them first
          results = (fullParts.length > 0 ? fullParts : results).slice(0, limit);
        } else {
          results = results.slice(0, limit);
        }
      }

      resolve(results);
    });

    proc.on('error', err => {
      reject(err);
    });
  });
}

function downloadVideoPart(video, seriesName, baseOutputDir, onProgress) {
  return new Promise(async (resolve, reject) => {
    const safeSeries = sanitizeFilename(seriesName || 'Series');
    const safeTitle = sanitizeFilename(video.title);
    const targetDir = path.join(baseOutputDir, 'Shows & Movies', safeSeries);

    await fs.promises.mkdir(targetDir, { recursive: true });

    const finalPath = path.join(targetDir, `${safeTitle}.mp4`);

    // Check if already downloaded
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 1000000) {
      if (onProgress) onProgress({ status: 'done', percent: 100, file: finalPath });
      return resolve(finalPath);
    }

    const tempTemplate = path.join(targetDir, `.temp_${video.id}_%(id)s.%(ext)s`);

    const args = [
      '--js-runtimes', `node:${process.execPath}`,
      '--ffmpeg-location', FFMPEG_PATH,
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--newline',
      '-o', tempTemplate,
      video.url
    ];

    const proc = spawn(YTDLP_PATH, args);

    proc.stdout.on('data', data => {
      const text = data.toString();
      const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (match && onProgress) {
        onProgress({ status: 'downloading', percent: parseFloat(match[1]) });
      }
    });

    proc.on('close', async code => {
      if (code === 0) {
        try {
          const files = await fs.promises.readdir(targetDir);
          const matched = files.find(f => f.startsWith(`.temp_${video.id}_`) && f.endsWith('.mp4'));
          if (matched) {
            const tempFilePath = path.join(targetDir, matched);
            await fs.promises.rename(tempFilePath, finalPath);
            if (onProgress) onProgress({ status: 'done', percent: 100, file: finalPath });
            return resolve(finalPath);
          }
        } catch (e) {}
        resolve(finalPath);
      } else {
        reject(new Error(`Video download exited with code ${code}`));
      }
    });

    proc.on('error', err => {
      reject(err);
    });
  });
}

module.exports = {
  searchVideoSeries,
  downloadVideoPart,
  sanitizeFilename
};
