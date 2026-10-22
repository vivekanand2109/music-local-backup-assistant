const ngrok = require('@ngrok/ngrok');
const fs = require('fs');
const path = require('path');

let localConfig = {};
try {
  const configPath = path.join(__dirname, '../config.local.json');
  if (fs.existsSync(configPath)) {
    localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) {}

const NGROK_AUTHTOKEN = process.env.NGROK_AUTHTOKEN || localConfig.ngrokAuthtoken || '';
const NGROK_DOMAIN = process.env.NGROK_DOMAIN || localConfig.ngrokDomain || 'spleen-uniformly-seminar.ngrok-free.dev';

class TunnelManager {
  constructor(localPort = 3300) {
    this.localPort = localPort;
    this.urlFile = path.join(__dirname, '../public_url.txt');
    this.listener = null;
    this.publicUrl = `https://${NGROK_DOMAIN}`;
    this.isStopping = false;
    this.reconnectTimer = null;
  }

  async start() {
    if (this.listener) return;
    this.isStopping = false;

    console.log('🌐 Starting Permanent Ngrok Tunnel for domain:', NGROK_DOMAIN);

    try {
      this.listener = await ngrok.forward({
        addr: this.localPort,
        authtoken: NGROK_AUTHTOKEN,
        domain: NGROK_DOMAIN
      });

      this.publicUrl = this.listener.url() || `https://${NGROK_DOMAIN}`;
      fs.writeFileSync(this.urlFile, this.publicUrl, 'utf8');

      console.log('\n============================================================');
      console.log('🌍 PERMANENT FIXED WORLDWIDE URL IS LIVE:');
      console.log(`   👉 ${this.publicUrl}`);
      console.log('   (This URL NEVER changes and NEVER expires!)');
      console.log('============================================================\n');

    } catch (err) {
      console.error('⚠️ Ngrok tunnel error:', err.message);
      if (!this.isStopping) {
        console.log('Retrying in 5 seconds...');
        this.reconnectTimer = setTimeout(() => this.start(), 5000);
      }
    }
  }

  async stop() {
    this.isStopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.listener) {
      try {
        await this.listener.close();
      } catch (e) {}
      this.listener = null;
    }
  }

  getPublicUrl() {
    return this.publicUrl || `https://${NGROK_DOMAIN}`;
  }
}

module.exports = TunnelManager;
