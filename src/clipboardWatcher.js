const { exec } = require('child_process');

class ClipboardWatcher {
  constructor(onUrlDetected) {
    this.onUrlDetected = onUrlDetected;
    this.enabled = true;
    this.intervalId = null;
    this.lastUrl = '';
    this.urlRegex = /https?:\/\/music\.apple\.com\/[^\s"']+/i;
  }

  start(intervalMs = 1500) {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      if (!this.enabled) return;
      this.checkClipboard();
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  checkClipboard() {
    exec('pbpaste', (err, stdout) => {
      if (err || !stdout) return;
      const text = stdout.trim();
      const match = text.match(this.urlRegex);
      if (match) {
        const foundUrl = match[0];
        if (foundUrl !== this.lastUrl) {
          this.lastUrl = foundUrl;
          if (this.onUrlDetected) {
            this.onUrlDetected(foundUrl);
          }
        }
      }
    });
  }

  setEnabled(val) {
    this.enabled = !!val;
    if (this.enabled) {
      // Clear lastUrl so re-copying works
      this.lastUrl = '';
    }
  }

  isEnabled() {
    return this.enabled;
  }
}

module.exports = ClipboardWatcher;
