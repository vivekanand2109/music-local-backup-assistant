// State
let currentAlbum = null;
let currentPlaylist = [];
let currentTrackIndex = -1;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let parsedLyrics = [];

// DOM Elements
const urlInput = document.getElementById('url-input');
const btnFetch = document.getElementById('btn-fetch');
const welcomeState = document.getElementById('welcome-state');
const albumContainer = document.getElementById('album-container');
const albumArt = document.getElementById('album-art');
const albumTitle = document.getElementById('album-title');
const albumArtist = document.getElementById('album-artist');
const albumGenre = document.getElementById('album-genre');
const albumYear = document.getElementById('album-year');
const albumCount = document.getElementById('album-count');
const albumSizeBullet = document.getElementById('album-size-bullet');
const albumTotalSize = document.getElementById('album-total-size');
const tracksList = document.getElementById('tracks-list');
const btnDownloadAlbum = document.getElementById('btn-download-album');
const downloadAlbumText = document.getElementById('download-album-text');
const btnPlayAlbum = document.getElementById('btn-play-album');
const btnOpenAlbumFolder = document.getElementById('btn-open-album-folder');
const albumProgressBox = document.getElementById('album-progress-box');
const albumProgressText = document.getElementById('album-progress-text');
const albumProgressSpeed = document.getElementById('album-progress-speed');
const albumProgressPercent = document.getElementById('album-progress-percent');
const albumProgressFill = document.getElementById('album-progress-fill');
const btnCancelAlbum = document.getElementById('btn-cancel-album');

// Universal Single Media Elements
const singleMediaContainer = document.getElementById('single-media-container');
const mediaCardThumb = document.getElementById('media-card-thumb');
const mediaPlatformBadge = document.getElementById('media-platform-badge');
const mediaTypePill = document.getElementById('media-type-pill');
const mediaDuration = document.getElementById('media-duration');
const mediaSizePill = document.getElementById('media-size-pill');
const mediaTitle = document.getElementById('media-title');
const mediaArtist = document.getElementById('media-artist');
const btnDownloadMp3 = document.getElementById('btn-download-mp3');
const textDownloadMp3 = document.getElementById('text-download-mp3');
const btnDownloadMp4 = document.getElementById('btn-download-mp4');
const textDownloadMp4 = document.getElementById('text-download-mp4');
const btnOpenSingleFinder = document.getElementById('btn-open-single-finder');
const mediaProgressBox = document.getElementById('media-progress-box');
const mediaProgressText = document.getElementById('media-progress-text');
const mediaProgressSpeed = document.getElementById('media-progress-speed');
const mediaProgressPercent = document.getElementById('media-progress-percent');
const mediaProgressFill = document.getElementById('media-progress-fill');
const btnCancelSingleMedia = document.getElementById('btn-cancel-single-media');
let currentSingleMedia = null;
let activeDownloadJobId = null;

// Apple Music Quality State
let currentAudioQuality = localStorage.getItem('apple_music_quality') || 'lossless';
let currentAudioCodec = localStorage.getItem('apple_music_codec') || 'alac';

function setAudioQuality(quality, codec) {
  if (quality) currentAudioQuality = quality;
  if (codec) currentAudioCodec = codec;
  localStorage.setItem('apple_music_quality', currentAudioQuality);
  localStorage.setItem('apple_music_codec', currentAudioCodec);

  // Sync header quality buttons
  document.querySelectorAll('.btn-quality-chip[data-quality]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.quality === currentAudioQuality);
  });

  // Sync album quality buttons
  document.querySelectorAll('.apple-lossless-badge-btn[data-album-quality]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.albumQuality === currentAudioQuality);
  });

  // Sync single media quality buttons
  document.querySelectorAll('.btn-quality-chip[data-single-quality]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.singleQuality === currentAudioQuality);
  });

  // Sync codec dropdown
  const codecSelect = document.getElementById('header-codec-select');
  if (codecSelect) codecSelect.value = currentAudioCodec;

  // Sync tech description
  const descEl = document.getElementById('album-quality-desc');
  if (descEl) {
    const codecName = currentAudioCodec.toUpperCase();
    if (currentAudioQuality === 'hires') {
      descEl.textContent = `${codecName} • Up to 24-bit / 192 kHz Studio Master Quality`;
    } else if (currentAudioQuality === 'lossless') {
      descEl.textContent = `${codecName} • Up to 24-bit / 48 kHz Lossless CD Quality`;
    } else {
      descEl.textContent = 'MP3 • 320 kbps High Quality';
    }
  }

  // Update Download Album Button text
  if (btnDownloadAlbum && downloadAlbumText) {
    const qLabel = currentAudioQuality === 'hires' ? 'Hi-Res Lossless' : (currentAudioQuality === 'lossless' ? 'Lossless' : 'High Quality');
    downloadAlbumText.textContent = `Download Album (${qLabel} ${currentAudioCodec.toUpperCase()})`;
  }

  // Update Single Media Download Button text
  if (textDownloadMp3) {
    const qLabel = currentAudioQuality === 'hires' ? 'Hi-Res Lossless (24-bit)' : (currentAudioQuality === 'lossless' ? 'Lossless (ALAC)' : 'MP3 (320k)');
    textDownloadMp3.textContent = `Download ${qLabel}`;
  }

  // Update track list badges if album is displayed
  document.querySelectorAll('.track-lossless-badge').forEach(badge => {
    if (currentAudioQuality === 'hires') {
      badge.textContent = 'HI-RES';
      badge.className = 'track-lossless-badge hires';
    } else if (currentAudioQuality === 'lossless') {
      badge.textContent = 'LOSSLESS';
      badge.className = 'track-lossless-badge';
    } else {
      badge.textContent = '320K';
      badge.className = 'track-lossless-badge';
    }
  });
}

const navDownloader = document.getElementById('nav-downloader');
const navLibrary = document.getElementById('nav-library');
const viewDownloader = document.getElementById('view-downloader');
const viewLibrary = document.getElementById('view-library');
const libraryGrid = document.getElementById('library-grid');
const libraryEmpty = document.getElementById('library-empty');
const btnRefreshLibrary = document.getElementById('btn-refresh-library');
const btnOpenFinder = document.getElementById('btn-open-finder');

const sidebarQueue = document.getElementById('sidebar-queue');
const queuePercent = document.getElementById('queue-percent');
const queueProgressBar = document.getElementById('queue-progress-bar');
const queueTrackStatus = document.getElementById('queue-track-status');
const btnCancelQueue = document.getElementById('btn-cancel-queue');

// Player DOM Elements
const audioEngine = document.getElementById('audio-engine');
const playerArt = document.getElementById('player-art');
const playerTitle = document.getElementById('player-title');
const playerArtist = document.getElementById('player-artist');
const btnPlayPause = document.getElementById('btn-play-pause');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const scrubberInput = document.getElementById('scrubber-input');
const scrubberFill = document.getElementById('scrubber-fill');
const volumeSlider = document.getElementById('volume-slider');

// Lyrics Pane
const lyricsPane = document.getElementById('lyrics-pane');
const btnLyricsToggle = document.getElementById('btn-lyrics-toggle');
const btnCloseLyrics = document.getElementById('btn-close-lyrics');
const lyricsContent = document.getElementById('lyrics-content');
const ambientBackdrop = document.getElementById('ambient-backdrop');

// Helper: Format milliseconds or seconds to MM:SS
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

// Navigation Tabs
navDownloader.addEventListener('click', () => {
  navDownloader.classList.add('active');
  navLibrary.classList.remove('active');
  viewDownloader.classList.remove('hidden');
  viewLibrary.classList.add('hidden');
});

navLibrary.addEventListener('click', () => {
  navLibrary.classList.add('active');
  navDownloader.classList.remove('active');
  viewLibrary.classList.remove('hidden');
  viewDownloader.classList.add('hidden');
  loadOfflineLibrary();
});

// Sample Chips
document.querySelectorAll('.sample-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    urlInput.value = btn.dataset.url;
    fetchAlbumFromUrl(btn.dataset.url);
  });
});

// Fetch Album Button
btnFetch.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (url) fetchAlbumFromUrl(url);
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const url = urlInput.value.trim();
    if (url) fetchAlbumFromUrl(url);
  }
});

// Universal Fetch & Inspect API (Any Platform)
async function fetchAlbumFromUrl(url) {
  btnFetch.disabled = true;
  btnFetch.innerHTML = '<span>Inspecting...</span>';

  try {
    const res = await fetch('/api/inspect-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to inspect link.');
    }

    const media = data.media;

    if (media.type === 'album' || media.type === 'playlist') {
      singleMediaContainer?.classList.add('hidden');
      displayAlbum(media.appleMusicRaw || media);
    } else {
      displaySingleMedia(media);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btnFetch.disabled = false;
    btnFetch.innerHTML = '<span>Fetch & Download</span>';
  }
}

// Display Single Media (YouTube, Instagram, Spotify Track, SoundCloud, etc.)
function displaySingleMedia(media) {
  currentSingleMedia = media;
  welcomeState.classList.add('hidden');
  albumContainer.classList.add('hidden');
  singleMediaContainer?.classList.remove('hidden');

  if (mediaCardThumb) {
    mediaCardThumb.src = media.artwork || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23222"/></svg>';
  }
  if (mediaPlatformBadge) {
    mediaPlatformBadge.textContent = `${media.platformIcon || '🌐'} ${media.platformName || 'Web'}`;
  }
  if (mediaTypePill) {
    mediaTypePill.textContent = (media.type || 'MEDIA').toUpperCase();
  }
  if (mediaDuration) {
    mediaDuration.textContent = media.durationString || '--:--';
  }
  if (mediaSizePill) {
    if (media.sizeFormatted) {
      mediaSizePill.textContent = media.sizeFormatted;
      mediaSizePill.classList.remove('hidden');
    } else {
      mediaSizePill.classList.add('hidden');
    }
  }
  if (mediaTitle) {
    mediaTitle.textContent = media.title;
  }
  if (mediaArtist) {
    mediaArtist.textContent = media.artist;
  }

  // Format buttons visibility
  if (btnDownloadMp4) {
    if (media.mediaFormats && media.mediaFormats.includes('mp4')) {
      btnDownloadMp4.classList.remove('hidden');
    } else {
      btnDownloadMp4.classList.add('hidden');
    }
  }

  // Reset download button states with sizes and quality
  const qLabel = currentAudioQuality === 'hires' ? 'Hi-Res Lossless (24-bit)' : (currentAudioQuality === 'lossless' ? `Lossless (${currentAudioCodec.toUpperCase()})` : 'MP3 (320k)');
  const mp4Size = media.estimatedSizes?.mp4 ? ` (${media.estimatedSizes.mp4})` : '';

  if (btnDownloadMp3) {
    btnDownloadMp3.disabled = false;
    if (textDownloadMp3) textDownloadMp3.textContent = `Download ${qLabel}`;
  }
  if (btnDownloadMp4) {
    btnDownloadMp4.disabled = false;
    if (textDownloadMp4) textDownloadMp4.textContent = `Download MP4 (Video)${mp4Size}`;
  }

  // Sync single media quality chips
  document.querySelectorAll('.btn-quality-chip[data-single-quality]').forEach(b => {
    b.classList.toggle('active', b.dataset.singleQuality === currentAudioQuality);
  });
  if (mediaProgressBox) {
    mediaProgressBox.classList.add('hidden');
  }
  if (mediaProgressSpeed) {
    mediaProgressSpeed.textContent = '';
  }

  if (media.artwork) {
    ambientBackdrop.style.background = `radial-gradient(circle, rgba(252, 60, 68, 0.22) 0%, rgba(0, 0, 0, 0) 70%)`;
  }
}

// Download Single Media Action
async function downloadMediaAction(format) {
  if (!currentSingleMedia) return;

  const btn = format === 'mp4' ? btnDownloadMp4 : btnDownloadMp3;
  if (btn) {
    btn.disabled = true;
    const span = btn.querySelector('span');
    const label = format === 'mp4' ? 'MP4' : (currentAudioQuality === 'hires' ? 'Hi-Res Lossless' : (currentAudioQuality === 'lossless' ? 'Lossless' : 'MP3'));
    if (span) span.textContent = `Downloading ${label}...`;
  }

  if (mediaProgressBox) {
    mediaProgressBox.classList.remove('hidden');
    mediaProgressPercent.textContent = '0%';
    mediaProgressFill.style.width = '0%';
    const label = format === 'mp4' ? 'MP4' : (currentAudioQuality === 'hires' ? 'Hi-Res Lossless' : (currentAudioQuality === 'lossless' ? 'Lossless' : 'MP3'));
    mediaProgressText.textContent = `Starting ${label} download...`;
    if (mediaProgressSpeed) mediaProgressSpeed.textContent = '';
  }

  sidebarQueue.classList.remove('hidden');
  queuePercent.textContent = '0%';
  queueProgressBar.style.width = '0%';
  queueTrackStatus.textContent = `${currentSingleMedia.title} (${format === 'mp4' ? 'MP4' : currentAudioQuality.toUpperCase()})`;

  try {
    const res = await fetch('/api/download-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: currentSingleMedia,
        format,
        quality: currentAudioQuality,
        codec: currentAudioCodec
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (data.jobId) activeDownloadJobId = data.jobId;
  } catch (err) {
    alert('Download error: ' + err.message);
    if (btn) {
      btn.disabled = false;
      const span = btn.querySelector('span');
      if (span) {
        if (format === 'mp4') {
          const mp4Size = currentSingleMedia.estimatedSizes?.mp4 ? ` (${currentSingleMedia.estimatedSizes.mp4})` : '';
          span.textContent = `Download MP4 (Video)${mp4Size}`;
        } else {
          const qLabel = currentAudioQuality === 'hires' ? 'Hi-Res Lossless (24-bit)' : (currentAudioQuality === 'lossless' ? `Lossless (${currentAudioCodec.toUpperCase()})` : 'MP3 (320k)');
          span.textContent = `Download ${qLabel}`;
        }
      }
    }
  }
}

async function cancelActiveDownload() {
  try {
    const res = await fetch('/api/cancel-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: activeDownloadJobId })
    });
    await res.json();
  } catch (e) {
    console.error('Cancel download error:', e);
  }
}

if (btnCancelSingleMedia) btnCancelSingleMedia.addEventListener('click', cancelActiveDownload);
if (btnCancelAlbum) btnCancelAlbum.addEventListener('click', cancelActiveDownload);
if (btnCancelQueue) btnCancelQueue.addEventListener('click', cancelActiveDownload);

if (btnDownloadMp3) {
  btnDownloadMp3.addEventListener('click', () => downloadMediaAction('mp3'));
}
if (btnDownloadMp4) {
  btnDownloadMp4.addEventListener('click', () => downloadMediaAction('mp4'));
}
if (btnOpenSingleFinder) {
  btnOpenSingleFinder.addEventListener('click', async () => {
    try {
      await fetch('/api/open-folder', { method: 'POST' });
    } catch (e) {}
  });
}

// Display Album UI
function displayAlbum(album) {
  currentAlbum = album;

  welcomeState.classList.add('hidden');
  singleMediaContainer?.classList.add('hidden');
  albumContainer.classList.remove('hidden');

  albumArt.src = album.artwork || '';
  albumTitle.textContent = album.title;
  albumArtist.textContent = album.artist;
  albumGenre.textContent = album.genre || 'Music';
  albumYear.textContent = album.year || '';
  albumCount.textContent = `${album.tracks.length} Songs`;

  if (albumTotalSize && albumSizeBullet) {
    if (album.totalSizeFormatted) {
      albumTotalSize.textContent = album.totalSizeFormatted;
      albumTotalSize.classList.remove('hidden');
      albumSizeBullet.classList.remove('hidden');
    } else {
      albumTotalSize.classList.add('hidden');
      albumSizeBullet.classList.add('hidden');
    }
  }

  // Dynamic ambient backdrop color
  if (album.artwork) {
    ambientBackdrop.style.background = `radial-gradient(circle, rgba(252, 60, 68, 0.22) 0%, rgba(0, 0, 0, 0) 70%)`;
  }

  // Render Tracks
  tracksList.innerHTML = '';
  album.tracks.forEach((track, idx) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.id = `track-row-${idx}`;

    const dur = track.durationMs ? formatTime(track.durationMs / 1000) : '--:--';
    const sizeSub = track.sizeFormatted ? `<span class="track-size-sub">${track.sizeFormatted}</span>` : '';

    row.innerHTML = `
      <div class="col-num">
        <span class="track-index">${track.trackNumber || idx + 1}</span>
        <button class="btn-inline-play" title="Play">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <polygon points="6 4 18 12 6 20 6 4"></polygon>
          </svg>
        </button>
      </div>
      <div class="col-title">
        <span class="track-title-text">${track.title} <span class="track-lossless-badge ${currentAudioQuality === 'hires' ? 'hires' : ''}">${currentAudioQuality === 'hires' ? 'HI-RES' : (currentAudioQuality === 'high' ? '320K' : 'LOSSLESS')}</span></span>
        <span class="track-artist-text">${track.artist}</span>
      </div>
      <div class="col-time col-time-stack">
        <span class="track-duration-text">${dur}</span>
        ${sizeSub}
      </div>
      <div class="col-action" id="track-action-${idx}">
        <button class="btn-download-track" data-index="${idx}">Download</button>
      </div>
    `;

    // Inline play button
    row.querySelector('.btn-inline-play').addEventListener('click', e => {
      e.stopPropagation();
      playTrackFromCurrentAlbum(idx);
    });

    // Row click
    row.addEventListener('click', () => {
      playTrackFromCurrentAlbum(idx);
    });

    // Single track download button
    row.querySelector('.btn-download-track').addEventListener('click', e => {
      e.stopPropagation();
      downloadSingleTrackAction(track, idx);
    });

    tracksList.appendChild(row);
  });

  // Sync Audio Quality badges and state
  setAudioQuality(currentAudioQuality, currentAudioCodec);

  // Reset Album progress box
  albumProgressBox.classList.add('hidden');
  if (albumProgressSpeed) albumProgressSpeed.textContent = '';
  btnDownloadAlbum.disabled = false;
}

// 1-Click Album Download
btnDownloadAlbum.addEventListener('click', async () => {
  if (!currentAlbum) return;

  const qLabel = currentAudioQuality === 'hires' ? 'Hi-Res Lossless' : (currentAudioQuality === 'lossless' ? 'Lossless' : 'High Quality');
  btnDownloadAlbum.disabled = true;
  downloadAlbumText.textContent = `Downloading ${qLabel}...`;
  albumProgressBox.classList.remove('hidden');
  albumProgressText.textContent = `Starting 1-Click Album Download (${qLabel} ${currentAudioCodec.toUpperCase()})...`;
  albumProgressPercent.textContent = '0%';
  albumProgressFill.style.width = '0%';
  if (albumProgressSpeed) albumProgressSpeed.textContent = '';

  sidebarQueue.classList.remove('hidden');
  queuePercent.textContent = '0%';
  queueProgressBar.style.width = '0%';
  queueTrackStatus.textContent = `Starting ${currentAlbum.title}...`;

  try {
    const res = await fetch('/api/download-album', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ album: currentAlbum, quality: currentAudioQuality, codec: currentAudioCodec })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (data.jobId) activeDownloadJobId = data.jobId;
  } catch (err) {
    alert('Download failed: ' + err.message);
    btnDownloadAlbum.disabled = false;
    setAudioQuality(currentAudioQuality, currentAudioCodec);
  }
});

// Download Single Track Action
async function downloadSingleTrackAction(track, idx) {
  const actionContainer = document.getElementById(`track-action-${idx}`);
  if (actionContainer) {
    actionContainer.innerHTML = `<span class="track-status-pill status-downloading">Downloading...</span>`;
  }

  const qLabel = currentAudioQuality === 'hires' ? 'Hi-Res' : (currentAudioQuality === 'lossless' ? 'Lossless' : 'MP3');
  sidebarQueue.classList.remove('hidden');
  queuePercent.textContent = '0%';
  queueProgressBar.style.width = '0%';
  queueTrackStatus.textContent = `Downloading "${track.title}" (${qLabel})...`;

  try {
    const res = await fetch('/api/download-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track,
        album: currentAlbum,
        trackIndex: idx,
        quality: currentAudioQuality,
        codec: currentAudioCodec
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start download');
    if (data.jobId) activeDownloadJobId = data.jobId;
  } catch (err) {
    if (actionContainer) {
      actionContainer.innerHTML = `<button class="btn-download-track" data-index="${idx}">Retry</button>`;
      actionContainer.querySelector('.btn-download-track')?.addEventListener('click', e => {
        e.stopPropagation();
        downloadSingleTrackAction(track, idx);
      });
    }
  }
}

// Play Album
btnPlayAlbum.addEventListener('click', () => {
  if (currentAlbum && currentAlbum.tracks.length > 0) {
    playTrackFromCurrentAlbum(0);
  }
});

// Open Album Folder in Finder
btnOpenAlbumFolder.addEventListener('click', () => {
  if (currentAlbum) {
    fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: currentAlbum.artist, album: currentAlbum.title })
    });
  }
});

btnOpenFinder.addEventListener('click', () => {
  fetch('/api/open-folder', { method: 'POST' });
});

const btnQuickFinder = document.getElementById('btn-quick-finder');
if (btnQuickFinder) {
  btnQuickFinder.addEventListener('click', () => {
    fetch('/api/open-folder', { method: 'POST' });
  });
}

// SSE Event Stream for live progress updates
function initEventSource() {
  const evtSource = new EventSource('/api/events');

  evtSource.addEventListener('download_progress', e => {
    const data = JSON.parse(e.data);
    handleDownloadProgress(data);
  });

  evtSource.addEventListener('track_progress', e => {
    const data = JSON.parse(e.data);
    handleDownloadProgress(data);
  });

  evtSource.addEventListener('track_started', e => {
    const data = JSON.parse(e.data);
    if (data.jobId) activeDownloadJobId = data.jobId;
    sidebarQueue.classList.remove('hidden');
    queuePercent.textContent = '0%';
    queueProgressBar.style.width = '0%';
    queueTrackStatus.textContent = `Downloading "${data.trackTitle}"...`;
    handleDownloadProgress(data);
  });

  evtSource.addEventListener('track_completed', e => {
    const data = JSON.parse(e.data);
    activeDownloadJobId = null;
    handleDownloadProgress({ ...data, status: 'done' });
    queuePercent.textContent = '100%';
    queueProgressBar.style.width = '100%';
    queueTrackStatus.textContent = `✓ Saved "${data.trackTitle}"`;
    setTimeout(() => {
      sidebarQueue.classList.add('hidden');
    }, 4000);
  });

  evtSource.addEventListener('track_error', e => {
    const data = JSON.parse(e.data);
    activeDownloadJobId = null;
    const idx = data.trackIndex;
    if (idx !== undefined && idx !== null) {
      const actionContainer = document.getElementById(`track-action-${idx}`);
      if (actionContainer) {
        actionContainer.innerHTML = `<button class="btn-download-track" data-index="${idx}" title="${data.error || 'Download failed'}">Retry</button>`;
        actionContainer.querySelector('.btn-download-track')?.addEventListener('click', ev => {
          ev.stopPropagation();
          if (currentAlbum && currentAlbum.tracks && currentAlbum.tracks[idx]) {
            downloadSingleTrackAction(currentAlbum.tracks[idx], idx);
          }
        });
      }
    }
    queueTrackStatus.textContent = `✕ Failed: ${data.trackTitle || 'Track'}`;
    setTimeout(() => {
      sidebarQueue.classList.add('hidden');
    }, 4000);
  });

  evtSource.addEventListener('track_cancelled', e => {
    const data = JSON.parse(e.data);
    activeDownloadJobId = null;
    const idx = data.trackIndex;
    if (idx !== undefined && idx !== null) {
      const actionContainer = document.getElementById(`track-action-${idx}`);
      if (actionContainer) {
        actionContainer.innerHTML = `<button class="btn-download-track" data-index="${idx}">Download</button>`;
        actionContainer.querySelector('.btn-download-track')?.addEventListener('click', ev => {
          ev.stopPropagation();
          if (currentAlbum && currentAlbum.tracks && currentAlbum.tracks[idx]) {
            downloadSingleTrackAction(currentAlbum.tracks[idx], idx);
          }
        });
      }
    }
    sidebarQueue.classList.add('hidden');
  });

  evtSource.addEventListener('album_started', e => {
    const data = JSON.parse(e.data);
    if (data.jobId) activeDownloadJobId = data.jobId;
    sidebarQueue.classList.remove('hidden');
    queuePercent.textContent = '0%';
    queueProgressBar.style.width = '0%';
    queueTrackStatus.textContent = `Downloading "${data.albumTitle}"...`;

    albumProgressBox.classList.remove('hidden');
    const sizeInfo = data.totalSizeFormatted ? ` (${data.totalSizeFormatted})` : '';
    albumProgressText.textContent = `Downloading "${data.albumTitle}"${sizeInfo}...`;
    albumProgressPercent.textContent = '0%';
    albumProgressFill.style.width = '0%';
    if (albumProgressSpeed) albumProgressSpeed.textContent = '';
    btnDownloadAlbum.disabled = true;
    downloadAlbumText.textContent = 'Downloading Album...';
  });

  evtSource.addEventListener('album_completed', e => {
    const data = JSON.parse(e.data);
    activeDownloadJobId = null;
    btnDownloadAlbum.disabled = false;
    downloadAlbumText.textContent = '✓ Album Downloaded';
    const sizeInfo = data.totalSizeFormatted ? ` (${data.totalSizeFormatted})` : '';
    albumProgressText.textContent = `Completed! Saved ${data.downloaded} of ${data.total} songs${sizeInfo} offline in Finder.`;
    albumProgressPercent.textContent = '100%';
    albumProgressFill.style.width = '100%';
    if (albumProgressSpeed) albumProgressSpeed.textContent = '';

    queuePercent.textContent = '100%';
    queueProgressBar.style.width = '100%';
    queueTrackStatus.textContent = 'Album Complete!';
    setTimeout(() => {
      sidebarQueue.classList.add('hidden');
    }, 4000);
  });

  evtSource.addEventListener('album_failed', e => {
    const data = JSON.parse(e.data);
    activeDownloadJobId = null;
    btnDownloadAlbum.disabled = false;
    downloadAlbumText.textContent = 'Download Album (1-Click)';
    albumProgressText.textContent = `Error: ${data.error}`;
    if (albumProgressSpeed) albumProgressSpeed.textContent = '';
  });

  evtSource.addEventListener('album_cancelled', e => {
    const data = JSON.parse(e.data);
    activeDownloadJobId = null;
    btnDownloadAlbum.disabled = false;
    downloadAlbumText.textContent = 'Download Album (1-Click)';
    albumProgressText.textContent = '✕ Album download cancelled.';
    albumProgressPercent.textContent = '';
    if (albumProgressSpeed) albumProgressSpeed.textContent = '';
    sidebarQueue.classList.add('hidden');
    setTimeout(() => { albumProgressBox.classList.add('hidden'); }, 3000);
  });

  evtSource.addEventListener('media_started', e => {
    const data = JSON.parse(e.data);
    if (data.jobId) activeDownloadJobId = data.jobId;
    sidebarQueue.classList.remove('hidden');
    queuePercent.textContent = '0%';
    queueProgressBar.style.width = '0%';
    queueTrackStatus.textContent = `Downloading "${data.title}"...`;

    if (mediaProgressBox) {
      mediaProgressBox.classList.remove('hidden');
      const sizeInfo = data.sizeFormatted ? ` • ${data.sizeFormatted}` : '';
      mediaProgressText.textContent = `Downloading "${data.title}" (${(data.format || 'mp3').toUpperCase()}${sizeInfo})...`;
      mediaProgressPercent.textContent = '0%';
      mediaProgressFill.style.width = '0%';
      if (mediaProgressSpeed) mediaProgressSpeed.textContent = '';
    }
  });

  evtSource.addEventListener('media_progress', e => {
    const data = JSON.parse(e.data);
    const pct = Math.round(data.percent || 0);

    if (mediaProgressPercent && mediaProgressFill) {
      mediaProgressPercent.textContent = `${pct}%`;
      mediaProgressFill.style.width = `${pct}%`;
      if (data.status === 'tagging') {
        mediaProgressText.textContent = 'Tagging & embedding artwork...';
      } else if (data.totalSize) {
        mediaProgressText.textContent = `Downloading ${data.title} (${data.totalSize})`;
      }
    }

    if (mediaProgressSpeed) {
      const parts = [];
      if (data.speed) parts.push(data.speed);
      if (data.eta) parts.push(`ETA ${data.eta}`);
      mediaProgressSpeed.textContent = parts.join(' • ');
    }

    queuePercent.textContent = `${pct}%`;
    queueProgressBar.style.width = `${pct}%`;
  });

  evtSource.addEventListener('media_completed', e => {
    const data = JSON.parse(e.data);
    activeDownloadJobId = null;
    const format = (data.format || 'mp3').toLowerCase();
    const btn = format === 'mp4' ? btnDownloadMp4 : btnDownloadMp3;

    if (btn) {
      btn.disabled = false;
      const sizeStr = data.fileSize ? ` (${data.fileSize})` : '';
      const span = btn.querySelector('span');
      if (span) span.textContent = `✓ Downloaded ${format.toUpperCase()}${sizeStr}`;
    }

    if (mediaProgressText) {
      const sizeStr = data.fileSize ? ` (${data.fileSize})` : '';
      mediaProgressText.textContent = `✓ Saved to Finder (${format.toUpperCase()}${sizeStr})!`;
      mediaProgressPercent.textContent = '100%';
      mediaProgressFill.style.width = '100%';
    }
    if (mediaProgressSpeed) mediaProgressSpeed.textContent = '';

    queuePercent.textContent = '100%';
    queueProgressBar.style.width = '100%';
    queueTrackStatus.textContent = 'Complete! Saved to Finder';
    setTimeout(() => { sidebarQueue.classList.add('hidden'); }, 4000);
  });

  evtSource.addEventListener('media_failed', e => {
    const data = JSON.parse(e.data);
    activeDownloadJobId = null;
    if (mediaProgressText) {
      mediaProgressText.textContent = `Error: ${data.error}`;
    }
    if (mediaProgressSpeed) mediaProgressSpeed.textContent = '';
    if (btnDownloadMp3) {
      btnDownloadMp3.disabled = false;
      const sizeStr = currentSingleMedia?.estimatedSizes?.mp3 ? ` (${currentSingleMedia.estimatedSizes.mp3})` : '';
      if (textDownloadMp3) textDownloadMp3.textContent = `Download MP3${sizeStr}`;
    }
    if (btnDownloadMp4) {
      btnDownloadMp4.disabled = false;
      const sizeStr = currentSingleMedia?.estimatedSizes?.mp4 ? ` (${currentSingleMedia.estimatedSizes.mp4})` : '';
      if (textDownloadMp4) textDownloadMp4.textContent = `Download MP4${sizeStr}`;
    }
  });

  evtSource.addEventListener('media_cancelled', e => {
    const data = JSON.parse(e.data);
    activeDownloadJobId = null;
    if (mediaProgressText) {
      mediaProgressText.textContent = '✕ Download cancelled.';
    }
    if (mediaProgressPercent) mediaProgressPercent.textContent = '';
    if (mediaProgressSpeed) mediaProgressSpeed.textContent = '';
    if (btnDownloadMp3) {
      btnDownloadMp3.disabled = false;
      const sizeStr = currentSingleMedia?.estimatedSizes?.mp3 ? ` (${currentSingleMedia.estimatedSizes.mp3})` : '';
      if (textDownloadMp3) textDownloadMp3.textContent = `Download MP3${sizeStr}`;
    }
    if (btnDownloadMp4) {
      btnDownloadMp4.disabled = false;
      const sizeStr = currentSingleMedia?.estimatedSizes?.mp4 ? ` (${currentSingleMedia.estimatedSizes.mp4})` : '';
      if (textDownloadMp4) textDownloadMp4.textContent = `Download MP4${sizeStr}`;
    }
    sidebarQueue.classList.add('hidden');
    setTimeout(() => { mediaProgressBox.classList.add('hidden'); }, 3000);
  });
}

// Share from Phone & Clipboard Watcher Management
const shareModal = document.getElementById('share-modal');
const btnShareModal = document.getElementById('btn-share-modal');
const btnOpenSharePill = document.getElementById('btn-open-share-pill');
const btnCloseShareModal = document.getElementById('btn-close-share-modal');
const mobileUrlInput = document.getElementById('mobile-url-input');
const linkTestMobile = document.getElementById('link-test-mobile');
const btnCopyMobileUrl = document.getElementById('btn-copy-mobile-url');
const worldwideUrlInput = document.getElementById('worldwide-url-input');
const btnCopyWorldwideUrl = document.getElementById('btn-copy-worldwide-url');
const linkTestWorldwide = document.getElementById('link-test-worldwide');
const headerWorldwideStatus = document.getElementById('header-worldwide-status');
const quickUrlDisplay = document.getElementById('quick-url-display');
const btnCopyQuickUrl = document.getElementById('btn-copy-quick-url');

async function loadNetworkInfo() {
  try {
    const res = await fetch('/api/network-info');
    if (res.ok) {
      const data = await res.json();
      if (mobileUrlInput) mobileUrlInput.value = data.localUrl || data.webUrl;
      if (linkTestMobile) linkTestMobile.href = data.localUrl || data.webUrl;

      if (data.publicUrl) {
        if (worldwideUrlInput) worldwideUrlInput.value = data.publicUrl;
        if (linkTestWorldwide) linkTestWorldwide.href = data.publicUrl;
        if (headerWorldwideStatus) headerWorldwideStatus.textContent = 'Worldwide: Active 🌍';
        if (quickUrlDisplay) quickUrlDisplay.textContent = `${data.publicUrl}/api/quick-download?url=[Apple-Music-Link]`;
      } else {
        if (worldwideUrlInput) worldwideUrlInput.value = 'Connecting worldwide tunnel...';
        setTimeout(loadNetworkInfo, 3000);
      }
    }
  } catch (err) {}
}

if (btnShareModal) btnShareModal.addEventListener('click', () => shareModal?.classList.remove('hidden'));
if (btnOpenSharePill) btnOpenSharePill.addEventListener('click', () => shareModal?.classList.remove('hidden'));
if (btnCloseShareModal) btnCloseShareModal.addEventListener('click', () => shareModal?.classList.add('hidden'));

if (shareModal) {
  shareModal.addEventListener('click', e => {
    if (e.target === shareModal) shareModal.classList.add('hidden');
  });
}

if (btnCopyMobileUrl) {
  btnCopyMobileUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(mobileUrlInput.value);
    btnCopyMobileUrl.textContent = 'Copied!';
    setTimeout(() => { btnCopyMobileUrl.textContent = 'Copy'; }, 2000);
  });
}

if (btnCopyWorldwideUrl) {
  btnCopyWorldwideUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(worldwideUrlInput.value);
    btnCopyWorldwideUrl.textContent = 'Copied!';
    setTimeout(() => { btnCopyWorldwideUrl.textContent = 'Copy Link'; }, 2000);
  });
}

if (btnCopyQuickUrl) {
  btnCopyQuickUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(quickUrlDisplay.textContent);
    btnCopyQuickUrl.textContent = '✓';
    setTimeout(() => { btnCopyQuickUrl.textContent = '📋'; }, 2000);
  });
}

loadNetworkInfo();

function handleDownloadProgress(data) {
  if (data.type === 'track_progress' || data.type === 'track_start' || data.type === 'track_complete' || data.status) {
    const idx = data.trackIndex;
    if (idx !== undefined && idx !== null) {
      const actionContainer = document.getElementById(`track-action-${idx}`);

      if (actionContainer) {
        if (data.status === 'downloading') {
          const sizeInfo = data.totalSize ? ` • ${data.totalSize}` : '';
          const pct = data.percent !== undefined ? `${data.percent}%` : '';
          actionContainer.innerHTML = `<span class="track-status-pill status-downloading">${pct}${sizeInfo}</span>`;
        } else if (data.status === 'tagging') {
          actionContainer.innerHTML = `<span class="track-status-pill status-tagging">Tagging...</span>`;
        } else if (data.status === 'done' || data.type === 'track_complete' || data.status === 'already_downloaded') {
          const sizeInfo = data.fileSize ? ` (${data.fileSize})` : '';
          actionContainer.innerHTML = `<span class="track-status-pill status-done" title="Open in Finder">Done${sizeInfo} ✓</span>`;
          actionContainer.querySelector('.status-done')?.addEventListener('click', (e) => {
            e.stopPropagation();
            fetch('/api/open-folder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ artist: currentAlbum?.artist, album: currentAlbum?.title })
            }).catch(() => {});
          });
        }
      }
    }

    if (albumProgressSpeed && (data.speed || data.eta)) {
      const parts = [];
      if (data.speed) parts.push(data.speed);
      if (data.totalSize) parts.push(data.totalSize);
      if (data.eta) parts.push(`ETA ${data.eta}`);
      albumProgressSpeed.textContent = parts.join(' • ');
    }

    // Update Overall Album progress if totalTracks is present (album download)
    if (data.totalTracks && data.trackNumber) {
      const overallPercent = Math.round(
        ((data.trackIndex + (data.percent ? data.percent / 100 : 0)) / data.totalTracks) * 100
      );
      albumProgressPercent.textContent = `${overallPercent}%`;
      albumProgressFill.style.width = `${overallPercent}%`;
      albumProgressText.textContent = `Downloading song ${data.trackNumber} of ${data.totalTracks}: "${data.trackTitle}"`;

      queuePercent.textContent = `${overallPercent}%`;
      queueProgressBar.style.width = `${overallPercent}%`;
      queueTrackStatus.textContent = `${data.trackNumber}/${data.totalTracks}: ${data.trackTitle}`;
    } else if (data.percent !== undefined) {
      const pct = Math.round(data.percent);
      queuePercent.textContent = `${pct}%`;
      queueProgressBar.style.width = `${pct}%`;
      queueTrackStatus.textContent = `${data.trackTitle || 'Song'}: ${pct}%`;
    }
  }
}

initEventSource();

// Audio Player & Playback Logic
function playTrackFromCurrentAlbum(idx) {
  if (!currentAlbum || !currentAlbum.tracks[idx]) return;

  currentPlaylist = currentAlbum.tracks.map(t => ({
    title: t.title,
    artist: t.artist,
    album: currentAlbum.title,
    artwork: currentAlbum.artwork,
    streamUrl: t.streamUrl || `/api/stream?artist=${encodeURIComponent(currentAlbum.artist)}&album=${encodeURIComponent(currentAlbum.title)}&file=${encodeURIComponent(t.filename || '')}`,
    previewUrl: t.previewUrl,
    lyricsUrl: t.lyricsUrl
  }));

  loadTrack(idx);
}

function loadTrack(idx) {
  if (idx < 0 || idx >= currentPlaylist.length) return;
  currentTrackIndex = idx;
  const track = currentPlaylist[idx];

  // Update Player Bar
  playerTitle.textContent = track.title;
  playerArtist.textContent = track.artist;
  playerArt.src = track.artwork || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%23222%22/></svg>';

  const playerQualityBadge = document.getElementById('player-quality-badge');
  if (playerQualityBadge) {
    const q = (track.audioQuality || (currentAudioQuality === 'hires' ? 'Hi-Res Lossless' : (currentAudioQuality === 'lossless' ? 'Lossless' : 'High Quality'))).toUpperCase();
    playerQualityBadge.textContent = q;
    playerQualityBadge.className = 'player-quality-pill ' + (q.includes('HI-RES') ? 'hires' : '');
    playerQualityBadge.classList.remove('hidden');
  }

  // Update tracklist row highlight
  document.querySelectorAll('.track-row').forEach(r => r.classList.remove('playing'));
  const row = document.getElementById(`track-row-${idx}`);
  if (row) row.classList.add('playing');

  // Use local stream if available, otherwise Apple Music official previewUrl
  const audioSrc = track.streamUrl && track.filename ? track.streamUrl : (track.previewUrl || track.streamUrl);
  audioEngine.src = audioSrc;
  audioEngine.play().then(() => {
    setPlayingState(true);
  }).catch(() => {
    // Autoplay blocked or wait for user interaction
  });

  // Load lyrics
  loadLyrics(track);
}

function setPlayingState(playing) {
  isPlaying = playing;
  if (playing) {
    iconPlay.classList.add('hidden');
    iconPause.classList.remove('hidden');
  } else {
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
  }
}

btnPlayPause.addEventListener('click', () => {
  if (!audioEngine.src) {
    if (currentPlaylist.length > 0) loadTrack(0);
    return;
  }
  if (audioEngine.paused) {
    audioEngine.play();
    setPlayingState(true);
  } else {
    audioEngine.pause();
    setPlayingState(false);
  }
});

btnPrev.addEventListener('click', () => {
  if (audioEngine.currentTime > 3) {
    audioEngine.currentTime = 0;
  } else if (currentTrackIndex > 0) {
    loadTrack(currentTrackIndex - 1);
  }
});

btnNext.addEventListener('click', () => {
  if (isShuffle) {
    const nextIdx = Math.floor(Math.random() * currentPlaylist.length);
    loadTrack(nextIdx);
  } else if (currentTrackIndex < currentPlaylist.length - 1) {
    loadTrack(currentTrackIndex + 1);
  }
});

btnShuffle.addEventListener('click', () => {
  isShuffle = !isShuffle;
  btnShuffle.classList.toggle('active', isShuffle);
});

btnRepeat.addEventListener('click', () => {
  isRepeat = !isRepeat;
  btnRepeat.classList.toggle('active', isRepeat);
});

// Time updates & Scrubber
audioEngine.addEventListener('timeupdate', () => {
  const cur = audioEngine.currentTime;
  const dur = audioEngine.duration || 0;
  timeCurrent.textContent = formatTime(cur);
  timeTotal.textContent = formatTime(dur);

  if (dur > 0) {
    const pct = (cur / dur) * 100;
    scrubberFill.style.width = `${pct}%`;
    scrubberInput.value = pct;
  }

  // Update lyrics sync
  updateLyricsHighlight(cur);
});

scrubberInput.addEventListener('input', e => {
  const pct = parseFloat(e.target.value);
  const dur = audioEngine.duration || 0;
  if (dur > 0) {
    const target = (pct / 100) * dur;
    audioEngine.currentTime = target;
    scrubberFill.style.width = `${pct}%`;
  }
});

volumeSlider.addEventListener('input', e => {
  audioEngine.volume = parseFloat(e.target.value);
});

audioEngine.addEventListener('ended', () => {
  if (isRepeat) {
    audioEngine.currentTime = 0;
    audioEngine.play();
  } else {
    btnNext.click();
  }
});

// Lyrics System
btnLyricsToggle.addEventListener('click', () => {
  lyricsPane.classList.toggle('hidden');
  btnLyricsToggle.classList.toggle('active', !lyricsPane.classList.contains('hidden'));
});

btnCloseLyrics.addEventListener('click', () => {
  lyricsPane.classList.add('hidden');
  btnLyricsToggle.classList.remove('active');
});

async function loadLyrics(track) {
  parsedLyrics = [];
  lyricsContent.innerHTML = '<p class="lyrics-placeholder">Loading lyrics...</p>';

  try {
    let lyricsText = null;
    if (track.lyricsUrl) {
      const res = await fetch(track.lyricsUrl);
      if (res.ok) lyricsText = await res.text();
    }

    if (!lyricsText) {
      // Fallback: fetch from lrclib
      const res = await fetch(
        `https://lrclib.net/api/get?artist_name=${encodeURIComponent(track.artist)}&track_name=${encodeURIComponent(track.title)}&album_name=${encodeURIComponent(track.album || '')}`
      );
      if (res.ok) {
        const data = await res.json();
        lyricsText = data.syncedLyrics || data.plainLyrics;
      }
    }

    if (!lyricsText) {
      lyricsContent.innerHTML = '<p class="lyrics-placeholder">No lyrics available for this song.</p>';
      return;
    }

    parseAndRenderLyrics(lyricsText);
  } catch (err) {
    lyricsContent.innerHTML = '<p class="lyrics-placeholder">No lyrics available.</p>';
  }
}

function parseAndRenderLyrics(lrcText) {
  lyricsContent.innerHTML = '';
  parsedLyrics = [];

  const lines = lrcText.split('\n');
  const hasTimestamps = /\[\d{2}:\d{2}/.test(lrcText);

  lines.forEach((line, i) => {
    const match = line.match(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/);
    if (match) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const time = mins * 60 + secs + ms / 1000;
      const text = match[4].trim();

      if (text) {
        const p = document.createElement('p');
        p.className = 'lyric-line';
        p.textContent = text;
        p.dataset.time = time;
        p.addEventListener('click', () => {
          audioEngine.currentTime = time;
        });
        lyricsContent.appendChild(p);
        parsedLyrics.push({ time, element: p });
      }
    } else if (!hasTimestamps && line.trim()) {
      const p = document.createElement('p');
      p.className = 'lyric-line';
      p.textContent = line.trim();
      lyricsContent.appendChild(p);
    }
  });
}

function updateLyricsHighlight(currentTime) {
  if (parsedLyrics.length === 0) return;

  let activeIndex = -1;
  for (let i = 0; i < parsedLyrics.length; i++) {
    if (currentTime >= parsedLyrics[i].time) {
      activeIndex = i;
    } else {
      break;
    }
  }

  parsedLyrics.forEach((item, i) => {
    if (i === activeIndex) {
      if (!item.element.classList.contains('active')) {
        item.element.classList.add('active');
        item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      item.element.classList.remove('active');
    }
  });
}

// Downloaded Library Tab
btnRefreshLibrary.addEventListener('click', loadOfflineLibrary);

async function loadOfflineLibrary() {
  try {
    const res = await fetch('/api/library');
    const data = await res.json();

    if (!data.albums || data.albums.length === 0) {
      libraryEmpty.classList.remove('hidden');
      libraryGrid.innerHTML = '';
      return;
    }

    libraryEmpty.classList.add('hidden');
    libraryGrid.innerHTML = '';

    data.albums.forEach(album => {
      const card = document.createElement('div');
      card.className = 'album-card';
      const cover = album.coverUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%23222%22/></svg>';

      let totalBytes = 0;
      if (album.tracks) {
        album.tracks.forEach(t => {
          totalBytes += (t.sizeBytes || 0);
          if (t.sizeBytes && !t.sizeFormatted) {
            t.sizeFormatted = formatBytes(t.sizeBytes);
          }
        });
      }
      const sizeSuffix = totalBytes > 0 ? ` • ${formatBytes(totalBytes)}` : '';
      album.totalSizeFormatted = totalBytes > 0 ? formatBytes(totalBytes) : null;

      card.innerHTML = `
        <div class="album-card-art-wrapper">
          <img src="${cover}" alt="${album.title}" class="album-card-art" />
        </div>
        <div class="album-card-title">${album.title}</div>
        <div class="album-card-artist">${album.artist} • ${album.trackCount} songs${sizeSuffix}</div>
      `;

      card.addEventListener('click', () => {
        // Load offline album into Downloader/Player view
        currentAlbum = {
          id: album.id,
          title: album.title,
          artist: album.artist,
          artwork: album.coverUrl,
          year: album.year,
          genre: album.genre,
          tracks: album.tracks
        };

        // Switch to Downloader view and display
        navDownloader.click();
        displayAlbum(currentAlbum);

        // Mark all as downloaded
        album.tracks.forEach((t, i) => {
          const act = document.getElementById(`track-action-${i}`);
          if (act) act.innerHTML = `<span class="track-status-pill status-done">Downloaded ✓</span>`;
        });
      });

      libraryGrid.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading library:', err);
  }
}

// Audio Quality Selectors Event Listeners
document.querySelectorAll('.btn-quality-chip[data-quality]').forEach(btn => {
  btn.addEventListener('click', () => {
    setAudioQuality(btn.dataset.quality, currentAudioCodec);
  });
});

document.querySelectorAll('.apple-lossless-badge-btn[data-album-quality]').forEach(btn => {
  btn.addEventListener('click', () => {
    setAudioQuality(btn.dataset.albumQuality, currentAudioCodec);
  });
});

document.querySelectorAll('.btn-quality-chip[data-single-quality]').forEach(btn => {
  btn.addEventListener('click', () => {
    setAudioQuality(btn.dataset.singleQuality, currentAudioCodec);
  });
});

const headerCodecSelect = document.getElementById('header-codec-select');
if (headerCodecSelect) {
  headerCodecSelect.value = currentAudioCodec;
  headerCodecSelect.addEventListener('change', (e) => {
    setAudioQuality(currentAudioQuality, e.target.value);
  });
}

// Initial sync
setAudioQuality(currentAudioQuality, currentAudioCodec);
