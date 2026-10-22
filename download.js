#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { fetchAppleMusicAlbum } = require('./src/appleMusic');
const { downloadAlbum } = require('./src/downloader');

const os = require('os');
const { exec } = require('child_process');

const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads', 'Apple Music');

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.log(`
========================================================================
  🍎 Apple Music 1-Click Offline Downloader
========================================================================

Usage:
  node download.js "<Apple-Music-Album-Or-Song-Link>"

Example:
  node download.js "https://music.apple.com/us/album/1989-taylors-version-deluxe/1713845538"

Or launch the Apple Music Web App interface:
  npm start
========================================================================
`);
    process.exit(1);
  }

  console.log('\n🔍 Fetching album metadata from Apple Music...');
  try {
    const album = await fetchAppleMusicAlbum(url.trim());
    console.log(`
🎵 Album:  ${album.title}
🎤 Artist: ${album.artist}
📅 Year:   ${album.year}  |  Genre: ${album.genre}
💿 Tracks: ${album.tracks.length}
🖼️ Cover:  ${album.artwork ? 'High-Resolution 3000x3000px available' : 'None'}
`);

    console.log('🚀 Starting 1-Click Album Download...\n');

    let currentTrackTitle = '';

    const result = await downloadAlbum(album, DOWNLOADS_DIR, progress => {
      if (progress.type === 'track_start') {
        currentTrackTitle = progress.trackTitle;
        process.stdout.write(`\n[${progress.trackNumber}/${progress.totalTracks}] "${progress.trackTitle}"... `);
      } else if (progress.type === 'track_progress') {
        if (progress.status === 'downloading') {
          process.stdout.write(`\r[${progress.trackNumber}/${progress.totalTracks}] "${progress.trackTitle}" [${progress.percent}%] `);
        } else if (progress.status === 'tagging') {
          process.stdout.write(`\r[${progress.trackNumber}/${progress.totalTracks}] "${progress.trackTitle}" [Tagging Apple Music metadata & lyrics...] `);
        } else if (progress.status === 'already_downloaded') {
          process.stdout.write(`\r[${progress.trackNumber}/${progress.totalTracks}] "${progress.trackTitle}" [Already downloaded ✓] `);
        }
      } else if (progress.type === 'track_complete') {
        process.stdout.write(`\r[${progress.trackNumber}/${progress.totalTracks}] "${progress.trackTitle}" [✓ Done]\n`);
      } else if (progress.type === 'track_error') {
        process.stdout.write(`\r[${progress.trackNumber}/${progress.totalTracks}] "${progress.trackTitle}" [⚠️ Error: ${progress.error}]\n`);
      }
    });

    console.log(`\n========================================================================`);
    console.log(`🎉 Download Complete!`);
    console.log(`📁 Downloaded ${result.downloaded} of ${result.total} songs.`);
    console.log(`📂 Location: ${result.albumDir}`);
    console.log(`💡 Opening folder in Finder...`);
    console.log(`========================================================================\n`);

    // Reveal in Finder automatically
    exec(`open "${result.albumDir}"`);

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
