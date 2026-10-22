# 🍎 Apple Music 1-Click Offline Downloader & Player

A modern offline music application that brings the **Apple Music macOS experience** directly to your Mac. Paste any Apple Music share link to download the entire album in 1-click, complete with:
- 🎶 **Original Apple Music Metadata**: Song titles, artist, album name, year, genre, track numbering, disc numbering.
- 🖼️ **Ultra-HD Album Art**: 3000x3000px official Apple Music cover art embedded directly inside every audio file.
- 🎤 **Real-time Synced Lyrics**: Embedded ID3 lyrics and `.lrc` files with karaoke-style highlighting.
- 🎧 **Offline Apple Music Player**: Built-in glassmorphism web player with scrubber, queue, lyrics drawer, shuffle & repeat.
- 📂 **Apple Music / iTunes Integration**: Drag-and-drop downloaded albums straight into macOS **Music.app**.

---

## 🚀 How to Use

### Method 1: The Apple Music Web App (Recommended)

1. Open your terminal and run:
   ```bash
   cd /Users/vivekanand/Documents/anti/apple-music-downloader
   ./start.sh
   ```
   *(Or simply run `npm start`)*

2. Your browser will open **http://localhost:3300** with the Apple Music interface.
3. Paste any Apple Music link (e.g. `https://music.apple.com/us/album/...`).
4. Click **"Download Album (1-Click)"**!
5. Enjoy listening offline in the built-in player or click **"Show in Finder"** to open your downloaded music files!

---

### Method 2: Terminal 1-Click Command (CLI)

You can also download directly from the command line:

```bash
cd /Users/vivekanand/Documents/anti/apple-music-downloader
node download.js "https://music.apple.com/us/album/1989-taylors-version-deluxe/1713845538"
```

---

## 📁 Download Directory Structure

Downloaded music is saved directly in your Mac Finder **Downloads** folder:

```
~/Downloads/Apple Music/
└── <Artist Name>/
    └── <Album Title>/
        ├── cover.jpg               (3000x3000px Ultra HD Album Art)
        ├── Song Title.mp3          (Tagged with ID3v2 + Embedded Cover + Lyrics)
        ├── Song Title.lrc          (Synced Karaoke Lyrics)
        └── Another Song Title.mp3
```

---

---

## 📲 Share & Download From Anywhere

You can send songs and albums to your Mac from **any device or app**:

### 1. Universal Clipboard (Instant Magic on iPhone & Mac)
If your iPhone and Mac share the same Apple ID:
1. In the **Apple Music app on iPhone**, tap **Share → Copy Link**.
2. Within seconds, your Mac automatically detects the link from your clipboard, displays a macOS notification, and downloads the album straight into Finder without you clicking anything!
3. To toggle this feature, click **"Auto-Download"** at the top of the web app.

### 2. From Your Phone (iPhone / Android)
1. Make sure your phone is connected to the same Wi-Fi network.
2. Open Safari or Chrome on your phone and go to:
   ```text
   http://10.221.199.49:3300
   ```
3. *(Optional)* Tap **Share → "Add to Home Screen"** on iPhone. It installs as a real Apple Music app on your phone!
4. Paste any link on your phone and tap Download — it downloads directly onto your Mac at home!

### 3. Apple Shortcuts (iOS Share Sheet)
Create a quick shortcut in the **Shortcuts app** on iPhone:
- **Shortcut Input:** Apple Music URL
- **Action:** Get Contents of `http://10.221.199.49:3300/api/quick-download?url=[Shortcut Input]`
- Whenever you tap **Share** on any song or album in Apple Music, pick your shortcut to send it straight to your Mac's Finder!
