// Autonomous Cloud API Routing (Netlify Serverless)
function apiUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
  return path.startsWith('/') ? path : `/${path}`;
}

// Generate direct browser download stream URL
function getDirectDownloadUrl(track) {
  if (!track) return '#';
  const title = encodeURIComponent(track.title || 'Track');
  const artist = encodeURIComponent(track.artist || 'Artist');
  const preview = encodeURIComponent(track.previewUrl || '');
  const token = encodeURIComponent(track.downloadToken || '');
  const query = encodeURIComponent(track.searchQuery || `${track.title || ''} ${track.artist || ''}`);
  return apiUrl(`/api/download?title=${title}&artist=${artist}&preview=${preview}&token=${token}&q=${query}`);
}

// Resolve playable audio URL (uses native preview CDN if available, or direct high-speed /api/download stream)
function getPlayableAudioUrl(track) {
  if (!track) return '';
  if (track.previewUrl && typeof track.previewUrl === 'string' && track.previewUrl.startsWith('http')) {
    return track.previewUrl;
  }
  return getDirectDownloadUrl(track);
}

// Directly trigger native browser file download (bypasses async popup blockers)
function triggerBrowserDownload(url, filename) {
  if (!url || url === '#') return;
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename || 'Music.mp3';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 2500);
}

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

  // Sync confirm modal quality buttons
  document.querySelectorAll('.btn-quality-chip[data-confirm-quality]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.confirmQuality === currentAudioQuality);
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

const navHome = document.getElementById('nav-home');
const navDownloader = document.getElementById('nav-downloader');
const navLibrary = document.getElementById('nav-library');
const navShows = document.getElementById('nav-shows');
const viewHome = document.getElementById('view-home');
const viewDownloader = document.getElementById('view-downloader');
const viewLibrary = document.getElementById('view-library');
const viewShows = document.getElementById('view-shows');
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

// Centralized View Switching Engine
function switchMainView(targetId) {
  document.querySelectorAll('.view-section').forEach(view => {
    if (view.id === targetId) {
      view.classList.remove('hidden');
      view.classList.add('active');
    } else {
      view.classList.add('hidden');
      view.classList.remove('active');
    }
  });

  // Desktop Navigation active highlight
  document.querySelectorAll('.nav-item').forEach(item => {
    const isTarget =
      (targetId === 'view-home' && item.id === 'nav-home') ||
      (targetId === 'view-downloader' && item.id === 'nav-downloader') ||
      (targetId === 'view-shows' && item.id === 'nav-shows') ||
      (targetId === 'view-library' && item.id === 'nav-library');
    item.classList.toggle('active', isTarget);
  });

  // Mobile Bottom Tab Bar active highlight
  document.querySelectorAll('.mobile-nav-btn[data-target]').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.target === targetId);
  });

  if (targetId === 'view-library') {
    loadOfflineLibrary();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Navigation Listeners
navHome?.addEventListener('click', () => switchMainView('view-home'));
navDownloader?.addEventListener('click', () => switchMainView('view-downloader'));
navLibrary?.addEventListener('click', () => switchMainView('view-library'));
navShows?.addEventListener('click', () => switchMainView('view-shows'));

// Landing Page Hero & CTA Buttons
document.getElementById('btn-hero-launch')?.addEventListener('click', () => {
  switchMainView('view-downloader');
  urlInput?.focus();
});

document.getElementById('btn-hero-explore')?.addEventListener('click', () => {
  document.getElementById('section-features')?.scrollIntoView({ behavior: 'smooth' });
});

document.getElementById('btn-cta-launch')?.addEventListener('click', () => {
  switchMainView('view-downloader');
  urlInput?.focus();
});

document.getElementById('btn-footer-home')?.addEventListener('click', (e) => {
  e.preventDefault();
  switchMainView('view-home');
});

document.getElementById('btn-footer-downloader')?.addEventListener('click', (e) => {
  e.preventDefault();
  switchMainView('view-downloader');
});

// Quick Connectors Bar in Downloader View
document.querySelectorAll('.d-conn-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sampleUrl = btn.dataset.sample;
    if (sampleUrl) {
      urlInput.value = sampleUrl;
      showToast(`Loaded ${btn.textContent.trim()} sample`);
      fetchAlbumFromUrl(sampleUrl);
    }
  });
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

// Direct Link Play Button
const btnPlayLink = document.getElementById('btn-play-link');
if (btnPlayLink) {
  btnPlayLink.addEventListener('click', async () => {
    const url = urlInput?.value?.trim();
    if (!url) {
      showToast('Please paste a music link first!', '⚠️');
      urlInput?.focus();
      return;
    }

    btnPlayLink.disabled = true;
    const span = document.getElementById('text-play-link');
    if (span) span.textContent = 'Loading...';

    try {
      showToast('🔍 Inspecting stream for playback...', '⏳');
      let res;
      try {
        res = await fetch(apiUrl('/api/inspect-link'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
      } catch (netErr) {
        res = await fetch('https://appllifymusic.netlify.app/api/inspect-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to inspect link.');
      }

      const media = data.media;
      pendingInspectedMedia = media;

      if (media.type === 'album' || media.type === 'playlist') {
        proceedWithInspectedMedia(media);
        playTrackFromCurrentAlbum(0);
      } else {
        proceedWithInspectedMedia(media);
        playMedia(media);
      }
    } catch (err) {
      console.warn('Play link error:', err);
      showToast(err.message || 'Unable to play link. Please check URL.', '⚠️');
    } finally {
      btnPlayLink.disabled = false;
      if (span) span.textContent = 'Play';
    }
  });
}

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const url = urlInput.value.trim();
    if (url) fetchAlbumFromUrl(url);
  }
});

// Multi-stage Stepper Helper for Liquid Shimmer Animation
function updateStepper(type, stageNumber) {
  // type is 'single' or 'album', stageNumber is 1..5
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`stage-${type}-${i}`);
    if (!el) continue;
    if (i < stageNumber) {
      el.className = 'stage-step completed';
    } else if (i === stageNumber) {
      el.className = 'stage-step active pulse';
    } else {
      el.className = 'stage-step';
    }
  }
}

// Preview & Confirmation Dialogue Modal
let pendingInspectedMedia = null;

const previewConfirmModal = document.getElementById('preview-confirmation-modal');
const btnCloseConfirmModal = document.getElementById('btn-close-confirm-modal');
const btnCancelConfirm = document.getElementById('btn-cancel-confirm');
const confirmArtThumb = document.getElementById('confirm-art-thumb');
const confirmPlatformBadge = document.getElementById('confirm-platform-badge');
const confirmTypeBadge = document.getElementById('confirm-type-badge');
const confirmTrackCount = document.getElementById('confirm-track-count');
const confirmDurationTag = document.getElementById('confirm-duration-tag');
const confirmSizeTag = document.getElementById('confirm-size-tag');
const confirmMediaTitle = document.getElementById('confirm-media-title');
const confirmMediaArtist = document.getElementById('confirm-media-artist');
const confirmMediaAlbum = document.getElementById('confirm-media-album');
const confirmTracklistSnippet = document.getElementById('confirm-tracklist-snippet');
const snippetMoreCount = document.getElementById('snippet-more-count');
const confirmSnippetItems = document.getElementById('confirm-snippet-items');
const chkOwnershipAgree = document.getElementById('chk-ownership-agree');
const btnProceedDownload = document.getElementById('btn-proceed-download');

function openPreviewConfirmationModal(media) {
  if (!previewConfirmModal) {
    proceedWithInspectedMedia(media);
    return;
  }

  if (confirmArtThumb) {
    confirmArtThumb.src = media.artwork || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23222"/></svg>';
  }

  if (confirmPlatformBadge) {
    confirmPlatformBadge.textContent = `${media.platformIcon || '🎵'} ${media.platformName || 'Music'}`;
  }

  if (confirmTypeBadge) {
    confirmTypeBadge.textContent = (media.type || 'MEDIA').toUpperCase();
  }

  const isMulti = (media.type === 'album' || media.type === 'playlist');
  const trackList = media.tracks || media.appleMusicRaw?.tracks || [];

  if (confirmTrackCount) {
    confirmTrackCount.textContent = isMulti ? `${trackList.length} Tracks` : '1 Track';
  }

  if (confirmDurationTag) {
    confirmDurationTag.textContent = media.durationString || media.durationFormatted || '--:--';
  }

  if (confirmSizeTag) {
    confirmSizeTag.textContent = media.sizeFormatted || media.totalSizeFormatted || '~85 MB';
  }

  if (confirmMediaTitle) confirmMediaTitle.textContent = media.title || 'Untitled';
  if (confirmMediaArtist) confirmMediaArtist.textContent = media.artist || 'Unknown Artist';
  if (confirmMediaAlbum) confirmMediaAlbum.textContent = media.album || (isMulti ? 'Curated Album/Playlist' : media.title);

  // Tracklist snippet preview
  if (confirmTracklistSnippet && confirmSnippetItems) {
    confirmSnippetItems.innerHTML = '';
    if (isMulti && trackList.length > 0) {
      confirmTracklistSnippet.classList.remove('hidden');
      const snippetLimit = Math.min(trackList.length, 4);
      for (let i = 0; i < snippetLimit; i++) {
        const t = trackList[i];
        const row = document.createElement('div');
        row.className = 'snippet-track-row';
        row.innerHTML = `
          <span class="snip-num">${i + 1}</span>
          <span class="snip-title">${t.title || 'Song'}</span>
          <span class="snip-dur">${t.durationFormatted || t.duration || ''}</span>
        `;
        confirmSnippetItems.appendChild(row);
      }
      if (snippetMoreCount) {
        const remaining = trackList.length - snippetLimit;
        snippetMoreCount.textContent = remaining > 0 ? `+ ${remaining} more tracks in queue` : 'All tracks shown';
      }
    } else {
      confirmTracklistSnippet.classList.add('hidden');
    }
  }

  // Quality chip sync
  document.querySelectorAll('.btn-quality-chip[data-confirm-quality]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.confirmQuality === currentAudioQuality);
  });

  if (chkOwnershipAgree) {
    chkOwnershipAgree.checked = true;
  }

  previewConfirmModal.classList.remove('hidden');
}

function proceedWithInspectedMedia(media) {
  switchMainView('view-downloader');

  if (media.type === 'album' || media.type === 'playlist') {
    singleMediaContainer?.classList.add('hidden');
    displayAlbum(media.appleMusicRaw || media);
    albumContainer?.classList.remove('hidden');
    setTimeout(() => {
      albumContainer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    updateStepper('album', 1);
  } else {
    displaySingleMedia(media);
    singleMediaContainer?.classList.remove('hidden');
    setTimeout(() => {
      singleMediaContainer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    updateStepper('single', 1);
  }
}

if (btnProceedDownload) {
  btnProceedDownload.addEventListener('click', () => {
    if (chkOwnershipAgree && !chkOwnershipAgree.checked) {
      showToast('⚠️ Please verify playlist ownership / backup rights.');
      return;
    }

    if (!pendingInspectedMedia) return;
    const media = pendingInspectedMedia;
    previewConfirmModal?.classList.add('hidden');
    proceedWithInspectedMedia(media);

    if (media.type === 'album' || media.type === 'playlist') {
      showToast(`✓ Playlist ready! Tap any song to download, or click 1-Click Download Album.`, '✅');
    } else {
      // Direct browser download triggered by user click gesture
      const dlUrl = getDirectDownloadUrl(media);
      const dlFilename = `${media.artist || 'Artist'} - ${media.title || 'Track'}.mp3`;
      triggerBrowserDownload(dlUrl, dlFilename);
      showToast(`✓ Starting download for "${media.title}"!`, '✅');
    }
  });
}

// Play Online Button inside Preview Confirmation Modal
const btnPreviewPlayOnline = document.getElementById('btn-preview-play-online');
if (btnPreviewPlayOnline) {
  btnPreviewPlayOnline.addEventListener('click', () => {
    if (!pendingInspectedMedia) return;
    const media = pendingInspectedMedia;
    previewConfirmModal?.classList.add('hidden');
    proceedWithInspectedMedia(media);

    if (media.type === 'album' || media.type === 'playlist') {
      playTrackFromCurrentAlbum(0);
    } else {
      playMedia(media);
    }
  });
}

[btnCloseConfirmModal, btnCancelConfirm].forEach(btn => {
  btn?.addEventListener('click', () => {
    previewConfirmModal?.classList.add('hidden');
    pendingInspectedMedia = null;
  });
});

document.querySelectorAll('.btn-quality-chip[data-confirm-quality]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-quality-chip[data-confirm-quality]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setAudioQuality(btn.dataset.confirmQuality);
  });
});

// Universal Fetch & Inspect API (Any Platform)
async function fetchAlbumFromUrl(url) {
  btnFetch.disabled = true;
  btnFetch.innerHTML = '<span>Inspecting...</span>';

  try {
    let res;
    try {
      res = await fetch(apiUrl('/api/inspect-link'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
    } catch (netErr) {
      // Direct origin fallback in case page is mirrored or opened on alternate host
      res = await fetch('https://appllifymusic.netlify.app/api/inspect-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to inspect link.');
    }

    const media = data.media;
    pendingInspectedMedia = media;
    openPreviewConfirmationModal(media);
  } catch (err) {
    console.warn('Inspect error:', err);
    showToast(err.message || 'Unable to inspect link. Please check the URL.', '⚠️');
  } finally {
    btnFetch.disabled = false;
    btnFetch.innerHTML = '<span>Verify & Download</span>';
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
    ambientBackdrop.style.background = `radial-gradient(circle, rgba(168, 85, 247, 0.25) 0%, rgba(9, 9, 15, 0) 70%)`;
  }

  // Setup direct mobile/desktop download link button
  const directSaveBtn = document.getElementById('btn-single-direct-download');
  if (directSaveBtn) {
    const dlUrl = getDirectDownloadUrl(media);
    const dlFilename = `${media.artist || 'Artist'} - ${media.title || 'Track'}.mp3`;
    directSaveBtn.href = dlUrl;
    directSaveBtn.download = dlFilename;
    directSaveBtn.target = '_blank';
    directSaveBtn.rel = 'noopener noreferrer';
    directSaveBtn.innerHTML = `<span>⬇️ Direct Download "${media.title}" (.MP3)</span>`;
    directSaveBtn.classList.remove('hidden');
  }

  // Sync Play Online button state
  const singlePlayText = document.getElementById('text-single-play-online');
  if (singlePlayText) {
    const isThisTrackPlaying = isPlaying && currentPlaylist.length > 0 && currentPlaylist[0].title === media.title;
    singlePlayText.textContent = isThisTrackPlaying ? '⏸ Pause' : '▶ Play Online';
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

  const dlUrl = getDirectDownloadUrl(currentSingleMedia);
  const dlFilename = `${currentSingleMedia.artist || 'Artist'} - ${currentSingleMedia.title || 'Track'}.${format || 'mp3'}`;

  // 1. Immediately trigger native browser file download synchronously inside user gesture!
  triggerBrowserDownload(dlUrl, dlFilename);

  // 2. Setup direct mobile link button as persistent fallback
  const directSaveBtn = document.getElementById('btn-single-direct-download');
  if (directSaveBtn) {
    directSaveBtn.href = dlUrl;
    directSaveBtn.download = dlFilename;
    directSaveBtn.target = '_blank';
    directSaveBtn.rel = 'noopener noreferrer';
    directSaveBtn.innerHTML = `<span>⬇️ Tap Here to Save "${dlFilename}"</span>`;
    directSaveBtn.classList.remove('hidden');
  }

  if (mediaProgressBox) {
    mediaProgressBox.classList.remove('hidden');
    mediaProgressPercent.textContent = '100%';
    mediaProgressFill.style.width = '100%';
    mediaProgressText.textContent = `✓ Download queued! Check your browser's downloads folder.`;
    if (mediaProgressSpeed) mediaProgressSpeed.textContent = 'Instant';
  }
  updateStepper('single', 5);
  showToast(`✓ Starting download for "${currentSingleMedia.title}"!`, '✅');

  setTimeout(() => {
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
  }, 1500);
}

async function cancelActiveDownload() {
  try {
    const res = await fetch(apiUrl('/api/cancel-download'), {
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

// Play Single Track Online button
const btnSinglePlayOnline = document.getElementById('btn-play-single-track');
if (btnSinglePlayOnline) {
  btnSinglePlayOnline.addEventListener('click', () => {
    if (!currentSingleMedia) return;
    if (audioEngine.src && currentPlaylist.length > 0 && currentPlaylist[0].title === currentSingleMedia.title) {
      if (audioEngine.paused) {
        audioEngine.play();
        setPlayingState(true);
      } else {
        audioEngine.pause();
        setPlayingState(false);
      }
    } else {
      playMedia(currentSingleMedia);
    }
  });
}

if (btnDownloadMp3) {
  btnDownloadMp3.addEventListener('click', () => downloadMediaAction('mp3'));
}
if (btnDownloadMp4) {
  btnDownloadMp4.addEventListener('click', () => downloadMediaAction('mp4'));
}
if (btnOpenSingleFinder) {
  btnOpenSingleFinder.addEventListener('click', async () => {
    try {
      await fetch(apiUrl('/api/open-folder'), { method: 'POST' });
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
  const tracks = Array.isArray(album.tracks) ? album.tracks : [];
  albumCount.textContent = `${tracks.length} Songs`;

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
    ambientBackdrop.style.background = `radial-gradient(circle, rgba(168, 85, 247, 0.25) 0%, rgba(9, 9, 15, 0) 70%)`;
  }

  // Render Tracks
  tracksList.innerHTML = '';
  tracks.forEach((track, idx) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.id = `track-row-${idx}`;

    const dur = track.durationMs ? formatTime(track.durationMs / 1000) : '--:--';
    const sizeSub = track.sizeFormatted ? `<span class="track-size-sub">${track.sizeFormatted}</span>` : '';

    const dlUrl = getDirectDownloadUrl(track);
    const dlFilename = `${track.artist || album.artist || 'Artist'} - ${track.title}.mp3`;

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
        <a class="btn-download-track" href="${dlUrl}" download="${dlFilename}" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Download</span>
        </a>
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

    // Single track download direct click feedback
    const dlLink = row.querySelector('.btn-download-track');
    if (dlLink) {
      dlLink.addEventListener('click', e => {
        e.stopPropagation();
        dlLink.classList.add('status-done');
        dlLink.innerHTML = `<span>✓ Downloading...</span>`;
        showToast(`✓ Starting download for "${track.title}"!`, '✅');
      });
    }

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

  const tracks = Array.isArray(currentAlbum.tracks) ? currentAlbum.tracks : [];
  if (tracks.length === 0) {
    showToast('⚠️ No songs found in this playlist to download.', '⚠️');
    return;
  }

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
    showToast(`Starting batch download of ${tracks.length} songs...`, '⏳');
    updateStepper('album', 2);

    let count = 0;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const pct = Math.round(((i + 1) / tracks.length) * 100);
      albumProgressPercent.textContent = `${pct}%`;
      albumProgressFill.style.width = `${pct}%`;
      albumProgressText.textContent = `Downloading song ${i + 1} of ${tracks.length}: "${t.title}"...`;

      const dlUrl = getDirectDownloadUrl(t);
      const dlFilename = `${t.artist || currentAlbum.artist || 'Artist'} - ${t.title}.mp3`;
      triggerBrowserDownload(dlUrl, dlFilename);

      const actionContainer = document.getElementById(`track-action-${i}`);
      if (actionContainer) {
        actionContainer.innerHTML = `<a class="track-status-pill status-done" href="${dlUrl}" download="${dlFilename}" target="_blank" rel="noopener noreferrer">✓ Saved</a>`;
      }

      count++;
      await new Promise(r => setTimeout(r, 1200));
    }

    updateStepper('album', 5);
    albumProgressText.textContent = `✓ Queued all ${count} songs to your browser downloads!`;
    albumProgressPercent.textContent = '100%';
    albumProgressFill.style.width = '100%';
    downloadAlbumText.textContent = `✓ ${count} Songs Downloaded`;
    showToast(`✓ All ${count} songs sent to your downloads!`, '✅');
  } catch (err) {
    console.error('Download failed:', err);
    showToast('Download notice: ' + (err.message || 'Saved to offline library'), '⚠️');
  } finally {
    btnDownloadAlbum.disabled = false;
    setAudioQuality(currentAudioQuality, currentAudioCodec);
  }
});

// Download Single Track Action
async function downloadSingleTrackAction(track, idx) {
  const actionContainer = document.getElementById(`track-action-${idx}`);
  const dlUrl = getDirectDownloadUrl(track);
  const dlFilename = `${track.artist || currentAlbum?.artist || 'Artist'} - ${track.title}.mp3`;

  // Synchronously trigger native browser download
  triggerBrowserDownload(dlUrl, dlFilename);

  if (actionContainer) {
    actionContainer.innerHTML = `<a class="track-status-pill status-done" href="${dlUrl}" download="${dlFilename}" target="_blank" rel="noopener noreferrer">✓ Saved</a>`;
  }

  showToast(`✓ Starting download for "${track.title}"!`, '✅');
  return true;
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
    fetch(apiUrl('/api/open-folder'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: currentAlbum.artist, album: currentAlbum.title })
    });
  }
});

btnOpenFinder.addEventListener('click', () => {
  fetch(apiUrl('/api/open-folder'), { method: 'POST' });
});

const btnQuickFinder = document.getElementById('btn-quick-finder');
if (btnQuickFinder) {
  btnQuickFinder.addEventListener('click', () => {
    fetch(apiUrl('/api/open-folder'), { method: 'POST' });
  });
}

// SSE Event Stream for live progress updates
function initEventSource() {
  let evtSource;
  try {
    evtSource = new EventSource(apiUrl('/api/events'));
    evtSource.onerror = () => {
      // Gracefully close on serverless hosting where persistent SSE is not used
      evtSource.close();
    };
  } catch (e) {
    return;
  }

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
    updateStepper('album', 2);
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
    updateStepper('album', 5);
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
    updateStepper('single', 2);
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
        updateStepper('single', 4);
        mediaProgressText.textContent = 'Tagging & embedding artwork...';
      } else if (data.status === 'encoding') {
        updateStepper('single', 3);
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
    updateStepper('single', 5);
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

function handleDownloadProgress(data) {
  if (data.type === 'track_progress' || data.type === 'track_start' || data.type === 'track_complete' || data.status) {
    const idx = data.trackIndex;
    if (idx !== undefined && idx !== null) {
      const actionContainer = document.getElementById(`track-action-${idx}`);

      if (actionContainer) {
        if (data.status === 'downloading') {
          updateStepper('album', 2);
          updateStepper('single', 2);
          const sizeInfo = data.totalSize ? ` • ${data.totalSize}` : '';
          const pct = data.percent !== undefined ? `${data.percent}%` : '';
          actionContainer.innerHTML = `<span class="track-status-pill status-downloading">${pct}${sizeInfo}</span>`;
        } else if (data.status === 'tagging') {
          updateStepper('album', 4);
          updateStepper('single', 4);
          actionContainer.innerHTML = `<span class="track-status-pill status-tagging">Tagging...</span>`;
        } else if (data.status === 'done' || data.type === 'track_complete' || data.status === 'already_downloaded') {
          updateStepper('album', 4);
          updateStepper('single', 5);
          const sizeInfo = data.fileSize ? ` (${data.fileSize})` : '';
          actionContainer.innerHTML = `<span class="track-status-pill status-done" title="Open in Finder">Done${sizeInfo} ✓</span>`;
          actionContainer.querySelector('.status-done')?.addEventListener('click', (e) => {
            e.stopPropagation();
            fetch(apiUrl('/api/open-folder'), {
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
function playMedia(media) {
  if (!media) return;
  const audioSrc = getPlayableAudioUrl(media);
  currentPlaylist = [{
    title: media.title || 'Track',
    artist: media.artist || 'Artist',
    album: media.album || 'Single',
    artwork: media.artwork,
    previewUrl: media.previewUrl,
    streamUrl: audioSrc,
    lyricsUrl: media.lyricsUrl
  }];
  loadTrack(0);
}

function playTrackFromCurrentAlbum(idx) {
  if (!currentAlbum) return;
  const tracks = Array.isArray(currentAlbum.tracks) ? currentAlbum.tracks : [];
  if (!tracks[idx]) return;

  currentPlaylist = tracks.map((t) => ({
    title: t.title,
    artist: t.artist || currentAlbum.artist,
    album: currentAlbum.title,
    artwork: t.artwork || currentAlbum.artwork,
    streamUrl: getPlayableAudioUrl(t),
    previewUrl: t.previewUrl,
    lyricsUrl: t.lyricsUrl
  }));

  loadTrack(idx);
}

function loadTrack(idx) {
  if (idx < 0 || idx >= currentPlaylist.length) return;
  currentTrackIndex = idx;
  const track = currentPlaylist[idx];

  // Ensure bottom player bar is visible
  const playerBar = document.getElementById('app-player-bar');
  if (playerBar) {
    playerBar.classList.remove('hidden');
    playerBar.style.display = 'flex';
  }

  // Update Player Bar
  if (playerTitle) playerTitle.textContent = track.title || 'Unknown Title';
  if (playerArtist) playerArtist.textContent = track.artist || 'Unknown Artist';
  if (playerArt) {
    playerArt.src = track.artwork || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%23222%22/></svg>';
  }

  const playerQualityBadge = document.getElementById('player-quality-badge');
  if (playerQualityBadge) {
    playerQualityBadge.textContent = 'STREAMING (320K)';
    playerQualityBadge.classList.remove('hidden');
  }

  // Update tracklist row highlight
  document.querySelectorAll('.track-row').forEach(r => r.classList.remove('playing'));
  const row = document.getElementById(`track-row-${idx}`);
  if (row) row.classList.add('playing');

  // Direct playable stream URL: Preview CDN or /api/download audio stream
  const audioSrc = track.previewUrl || track.streamUrl || getPlayableAudioUrl(track);
  audioEngine.src = audioSrc;
  audioEngine.play().then(() => {
    setPlayingState(true);
    showToast(`▶ Now Playing: "${track.title}"`, '🎵');
  }).catch((err) => {
    console.warn('Audio play notice:', err.message);
    setPlayingState(false);
  });

  // Load lyrics
  loadLyrics(track);
}

function setPlayingState(playing) {
  isPlaying = playing;
  if (playing) {
    iconPlay?.classList.add('hidden');
    iconPause?.classList.remove('hidden');
  } else {
    iconPlay?.classList.remove('hidden');
    iconPause?.classList.add('hidden');
  }

  const singlePlayText = document.getElementById('text-single-play-online');
  if (singlePlayText) {
    singlePlayText.textContent = playing ? '⏸ Pause' : '▶ Play Online';
  }

  const previewPlayText = document.getElementById('text-preview-play-online');
  if (previewPlayText) {
    previewPlayText.textContent = playing ? '⏸ Pause' : '▶ Play Online';
  }

  const playerEqualizer = document.getElementById('player-equalizer');
  if (playerEqualizer) {
    if (playing) playerEqualizer.classList.remove('hidden');
    else playerEqualizer.classList.add('hidden');
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
      const res = await fetch(apiUrl(track.lyricsUrl));
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
    const res = await fetch(apiUrl('/api/library'));
    const data = await res.json();

    const navLibCount = document.getElementById('nav-library-count');
    if (navLibCount && data.albums) {
      navLibCount.textContent = data.albums.length;
    }

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
      const cover = album.coverUrl ? apiUrl(album.coverUrl) : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%23222%22/></svg>';

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


// ============================================================
// Appllify Music: Toasts, Mobile Tabs, SEO & Ads Manager
// ============================================================

// Toast Notification System
function showToast(message, icon = '✓') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.innerHTML = `<span style="color:#C084FC;font-size:16px;">${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px) scale(0.95)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Google Search Console & AdSense Monetization Manager
function initMonetizationAndSeo() {
  const savedGsc = localStorage.getItem('gsc_verification_token');
  const gscInput = document.getElementById('gsc-token-input');
  const gscMeta = document.getElementById('gsc-meta-tag');

  if (savedGsc) {
    if (gscInput) gscInput.value = savedGsc;
    if (gscMeta) gscMeta.setAttribute('content', savedGsc);
  }

  const btnSaveGsc = document.getElementById('btn-save-gsc');
  if (btnSaveGsc && gscInput) {
    btnSaveGsc.addEventListener('click', () => {
      let val = gscInput.value.trim();
      const match = val.match(/content=["']([^"']+)["']/i);
      if (match) val = match[1];

      localStorage.setItem('gsc_verification_token', val);
      if (gscMeta) gscMeta.setAttribute('content', val);
      showToast('Google Search Console verification code saved!', '🔍');
    });
  }

  // AdSense Publisher ID Manager
  const savedAdSense = localStorage.getItem('adsense_pub_id');
  const adInput = document.getElementById('adsense-client-input');
  const adScript = document.getElementById('google-adsense-script');

  if (savedAdSense) {
    if (adInput) adInput.value = savedAdSense;
    if (adScript) adScript.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${savedAdSense}`;
  }

  const btnSaveAdSense = document.getElementById('btn-save-adsense');
  if (btnSaveAdSense && adInput) {
    btnSaveAdSense.addEventListener('click', () => {
      let val = adInput.value.trim();
      if (!val) return;
      if (!val.startsWith('ca-pub-') && !val.startsWith('pub-')) {
        val = `ca-pub-${val}`;
      }
      localStorage.setItem('adsense_pub_id', val);
      if (adScript) adScript.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${val}`;
      showToast('Google AdSense Publisher ID updated!', '💰');
    });
  }

  // Backend URL Manager
  const savedBackend = localStorage.getItem('custom_backend_url');
  const backendInput = document.getElementById('custom-backend-input');
  if (backendInput) {
    backendInput.value = savedBackend || PERMANENT_BACKEND;
  }
  const btnSaveBackend = document.getElementById('btn-save-backend');
  if (btnSaveBackend && backendInput) {
    btnSaveBackend.addEventListener('click', () => {
      const val = backendInput.value.trim();
      if (val) {
        localStorage.setItem('custom_backend_url', val);
        showToast('Backend server URL saved!', '🖥️');
      } else {
        localStorage.removeItem('custom_backend_url');
        showToast('Reset to default backend.', 'ℹ️');
      }
    });
  }
}

// Monetization & GSC Settings Modal
const monetizationModal = document.getElementById('monetization-modal');
const btnOpenMonetization = document.getElementById('btn-open-monetization-modal');
const btnCloseMonetization = document.getElementById('btn-close-monetization-modal');
const btnFooterSettings = document.getElementById('btn-footer-settings');
const btnMobileSettings = document.getElementById('btn-mobile-settings-header');

[btnOpenMonetization, btnFooterSettings, btnMobileSettings].forEach(btn => {
  btn?.addEventListener('click', () => monetizationModal?.classList.remove('hidden'));
});
btnCloseMonetization?.addEventListener('click', () => monetizationModal?.classList.add('hidden'));

// Keyboard Shortcuts Modal
const shortcutsModal = document.getElementById('shortcuts-modal');
const btnOpenShortcuts = document.getElementById('btn-open-shortcuts');
const btnCloseShortcuts = document.getElementById('btn-close-shortcuts');

btnOpenShortcuts?.addEventListener('click', () => shortcutsModal?.classList.remove('hidden'));
btnCloseShortcuts?.addEventListener('click', () => shortcutsModal?.classList.add('hidden'));

// Dismiss top announcement banner
const topBanner = document.getElementById('appllify-top-banner');
const btnCloseBanner = document.getElementById('btn-close-top-banner');
btnCloseBanner?.addEventListener('click', () => {
  topBanner?.remove();
  localStorage.setItem('appllify_banner_dismissed', 'true');
});
if (localStorage.getItem('appllify_banner_dismissed') === 'true') {
  topBanner?.remove();
}

// Mobile Bottom Navigation Tabs
const mobileTabs = document.querySelectorAll('.mobile-nav-btn[data-target]');
mobileTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchMainView(tab.dataset.target);
  });
});

// Keyboard Shortcuts Global Listener
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    return;
  }

  if (e.code === 'Space') {
    e.preventDefault();
    btnPlayPause.click();
  } else if (e.code === 'ArrowRight' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    btnNext.click();
  } else if (e.code === 'ArrowLeft' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    btnPrev.click();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    if (audioEngine) audioEngine.currentTime = Math.min(audioEngine.duration || 0, audioEngine.currentTime + 5);
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    if (audioEngine) audioEngine.currentTime = Math.max(0, audioEngine.currentTime - 5);
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    if (audioEngine) {
      audioEngine.muted = !audioEngine.muted;
      showToast(audioEngine.muted ? 'Muted' : 'Unmuted', '🔊');
    }
  } else if (e.key === 'l' || e.key === 'L') {
    e.preventDefault();
    btnLyricsToggle.click();
  } else if (e.key === '/') {
    e.preventDefault();
    urlInput.focus();
  } else if (e.key === '?') {
    e.preventDefault();
    shortcutsModal?.classList.toggle('hidden');
  }
});

// Initialize on load
initMonetizationAndSeo();
