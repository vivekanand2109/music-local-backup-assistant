const fs = require('fs');
const path = require('path');
const NodeID3 = require('node-id3');
let mm;
try { mm = require('music-metadata'); } catch (e) {}

async function parseTrackMeta(filePath, file, defaultArtist, defaultAlbum, filesInDir) {
  const stats = await fs.promises.stat(filePath);
  const ext = path.extname(file).toLowerCase();
  
  let title = file.replace(/^\d+\s*-\s*/, '').replace(/\.(mp3|m4a|flac|aac)$/i, '');
  let artist = defaultArtist;
  let album = defaultAlbum;
  let trackNumber = 0;
  let albumYear = '';
  let albumGenre = 'Music';
  let audioQuality = 'High Quality';
  let codec = ext.replace('.', '').toUpperCase();

  if (ext === '.mp3') {
    try {
      const tags = NodeID3.read(filePath);
      if (tags.title) title = tags.title;
      if (tags.artist) artist = tags.artist;
      if (tags.album) album = tags.album;
      if (tags.trackNumber) {
        const num = parseInt(tags.trackNumber.split('/')[0], 10);
        if (!isNaN(num)) trackNumber = num;
      }
      if (tags.year) albumYear = tags.year;
      if (tags.genre) albumGenre = tags.genre;
    } catch (e) {}
  } else if (mm) {
    try {
      const meta = await mm.parseFile(filePath);
      if (meta.common.title) title = meta.common.title;
      if (meta.common.artist) artist = meta.common.artist;
      if (meta.common.album) album = meta.common.album;
      if (meta.common.track && meta.common.track.no) trackNumber = meta.common.track.no;
      if (meta.common.year) albumYear = String(meta.common.year);
      if (meta.common.genre && meta.common.genre[0]) albumGenre = meta.common.genre[0];
      if (meta.format.sampleRate >= 88200 || (meta.format.bitsPerSample && meta.format.bitsPerSample > 16)) {
        audioQuality = 'Hi-Res Lossless';
      } else if (meta.format.lossless || ext === '.m4a' || ext === '.flac') {
        audioQuality = 'Lossless';
      }
      if (meta.format.codec) codec = meta.format.codec;
    } catch (e) {}
  } else {
    if (ext === '.m4a' || ext === '.flac') audioQuality = 'Lossless';
  }

  const lrcFile = file.replace(/\.(mp3|m4a|flac|aac)$/i, '.lrc');
  const hasLyrics = Array.isArray(filesInDir) && filesInDir.includes(lrcFile);

  return {
    filename: file,
    title,
    artist,
    album,
    year: albumYear,
    genre: albumGenre,
    trackNumber,
    sizeBytes: stats.size,
    hasLyrics,
    audioQuality,
    codec,
    streamUrl: `/api/stream?artist=${encodeURIComponent(defaultArtist)}&album=${encodeURIComponent(defaultAlbum)}&file=${encodeURIComponent(file)}`,
    lyricsUrl: hasLyrics
      ? `/api/lyrics?artist=${encodeURIComponent(defaultArtist)}&album=${encodeURIComponent(defaultAlbum)}&file=${encodeURIComponent(lrcFile)}`
      : null
  };
}

async function getDownloadedLibrary(downloadsDir) {
  if (!fs.existsSync(downloadsDir)) {
    return { artists: [], albums: [], totalTracks: 0 };
  }

  const artists = [];
  const albums = [];
  let totalTracks = 0;

  try {
    const artistDirs = await fs.promises.readdir(downloadsDir, { withFileTypes: true });

    for (const artistDirent of artistDirs) {
      if (!artistDirent.isDirectory() || artistDirent.name.startsWith('.')) continue;

      const artistName = artistDirent.name;
      const artistPath = path.join(downloadsDir, artistName);
      const subEntries = await fs.promises.readdir(artistPath, { withFileTypes: true });

      const albumDirs = subEntries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
      const directAudioFiles = subEntries.filter(e => e.isFile() && !e.name.startsWith('.') && /\.(mp3|m4a|flac|aac)$/i.test(e.name)).map(e => e.name);
      const allFiles = subEntries.map(e => e.name);

      // 1. Process Album Subdirectories
      for (const albumDirent of albumDirs) {
        const albumName = albumDirent.name;
        const albumPath = path.join(artistPath, albumName);
        const files = await fs.promises.readdir(albumPath);

        const coverFile = files.find(f => f.toLowerCase() === 'cover.jpg' || f.toLowerCase() === 'cover.png');
        const audioFiles = files.filter(f => !f.startsWith('.') && /\.(mp3|m4a|flac|aac)$/i.test(f)).sort();

        const tracks = [];
        let albumYear = '';
        let albumGenre = 'Music';

        for (const file of audioFiles) {
          totalTracks++;
          const filePath = path.join(albumPath, file);
          const t = await parseTrackMeta(filePath, file, artistName, albumName, files);
          if (t.year) albumYear = t.year;
          if (t.genre) albumGenre = t.genre;
          t.trackNumber = t.trackNumber || (tracks.length + 1);
          tracks.push(t);
        }

        if (tracks.length > 0) {
          albums.push({
            id: `${artistName}___${albumName}`,
            artist: artistName,
            title: albumName,
            year: albumYear,
            genre: albumGenre,
            trackCount: tracks.length,
            coverUrl: coverFile
              ? `/api/cover?artist=${encodeURIComponent(artistName)}&album=${encodeURIComponent(albumName)}`
              : null,
            tracks: tracks.sort((a, b) => a.trackNumber - b.trackNumber)
          });
        }
      }

      // 2. Process Direct Singles in Artist Directory (e.g., downloadsDir / Artist / Song.m4a)
      if (directAudioFiles.length > 0) {
        const coverFile = allFiles.find(f => f.toLowerCase() === 'cover.jpg' || f.toLowerCase() === 'cover.png');
        const tracks = [];
        let albumYear = '';
        let albumGenre = 'Single';

        for (const file of directAudioFiles) {
          totalTracks++;
          const filePath = path.join(artistPath, file);
          const t = await parseTrackMeta(filePath, file, artistName, 'Singles', allFiles);
          if (t.year) albumYear = t.year;
          if (t.genre) albumGenre = t.genre;
          t.trackNumber = tracks.length + 1;
          tracks.push(t);
        }

        if (tracks.length > 0) {
          albums.push({
            id: `${artistName}___Singles`,
            artist: artistName,
            title: 'Singles',
            year: albumYear,
            genre: albumGenre,
            trackCount: tracks.length,
            coverUrl: coverFile
              ? `/api/cover?artist=${encodeURIComponent(artistName)}&album=Singles`
              : null,
            tracks
          });
        }
      }

      if ((albumDirs.length > 0 || directAudioFiles.length > 0) && !artists.includes(artistName)) {
        artists.push(artistName);
      }
    }
  } catch (err) {
    console.error('Error scanning downloaded library:', err);
  }

  return {
    artists,
    albums: albums.sort((a, b) => a.title.localeCompare(b.title)),
    totalTracks
  };
}

module.exports = {
  getDownloadedLibrary
};
