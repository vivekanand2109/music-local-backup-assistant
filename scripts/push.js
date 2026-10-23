const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const token = process.argv[2] || process.env.GITHUB_TOKEN;

if (!token) {
  console.error('\n❌ GitHub Personal Access Token (PAT) is required to push to GitHub.');
  console.error('\nUsage:');
  console.error('  node scripts/push.js <YOUR_GITHUB_TOKEN>');
  console.error('  or: GITHUB_TOKEN=ghp_xxx node scripts/push.js\n');
  console.error('How to generate one:');
  console.error('  1. Go to https://github.com/settings/tokens?type=beta or https://github.com/settings/tokens');
  console.error('  2. Generate a token with "Contents: Read & write" or "repo" permission');
  console.error('  3. Run the command with your token\n');
  process.exit(1);
}

async function main() {
  console.log('🚀 Pushing to https://github.com/vivekanand2109/music-local-backup-assistant.git ...');

  try {
    const pushResult = await git.push({
      fs,
      http,
      dir,
      remote: 'origin',
      ref: 'main',
      force: true,
      onAuth: () => ({ username: token, password: '' })
    });

    if (pushResult.ok) {
      console.log('\n🎉 PUSH SUCCESSFUL!');
      console.log('🔗 View your repo: https://github.com/vivekanand2109/music-local-backup-assistant');
    } else {
      console.error('Push finished with response:', pushResult);
    }
  } catch (err) {
    console.error('\n❌ Push failed:', err.message);
    if (err.data && err.data.response) {
      console.error('GitHub response:', err.data.response);
    }
    process.exit(1);
  }
}

main();
