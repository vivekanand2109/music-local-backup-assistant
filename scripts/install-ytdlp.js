const fs = require('fs');
const path = require('path');
const https = require('https');

const binDir = path.join(__dirname, '../bin');
const ytdlpPath = path.join(binDir, 'yt-dlp');

if (fs.existsSync(ytdlpPath)) {
  console.log('✓ yt-dlp binary is already present.');
  process.exit(0);
}

fs.mkdirSync(binDir, { recursive: true });
console.log('⬇️ Downloading yt-dlp binary...');

function download(url, dest, cb) {
  https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      return download(res.headers.location, dest, cb);
    }
    if (res.statusCode !== 200) {
      return cb(new Error(`Failed to download: status ${res.statusCode}`));
    }
    const file = fs.createWriteStream(dest);
    res.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        fs.chmodSync(dest, 0o755);
        cb(null);
      });
    });
  }).on('error', cb);
}

const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
download(downloadUrl, ytdlpPath, (err) => {
  if (err) {
    console.error('⚠️ Could not auto-download yt-dlp:', err.message);
    console.log('Please download manually from https://github.com/yt-dlp/yt-dlp/releases into bin/yt-dlp');
  } else {
    console.log('✓ yt-dlp successfully installed to bin/yt-dlp');
  }
});
