const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

class BrainLoader {
  constructor(brainDir, config) {
    this.brainDir = brainDir;
    this.config = config;
    this.files = {};
    this.watcher = null;
  }

  loadAll() {
    const brainFiles = this.config.brainFiles || [
      'brain/personality.md',
      'brain/behavior.md',
      'brain/rules.md',
      'brain/memory.md'
    ];

    this.files = {};
    
    for (const file of brainFiles) {
      const filePath = path.resolve(file);
      if (fs.existsSync(filePath)) {
        this.files[file] = fs.readFileSync(filePath, 'utf-8');
      }
    }

    console.log('🧠 Brain loaded:', Object.keys(this.files).length, 'files');
    return this.files;
  }

  buildPrompt(incomingMessage, userContext) {
    const parts = [];

    if (this.files['brain/personality.md']) {
      parts.push(`[PERSONALITY]\n${this.files['brain/personality.md']}`);
    }
    if (this.files['brain/behavior.md']) {
      parts.push(`[BEHAVIOR]\n${this.files['brain/behavior.md']}`);
    }
    if (this.files['brain/rules.md']) {
      parts.push(`[RULES]\n${this.files['brain/rules.md']}`);
    }
    if (this.files['brain/memory.md']) {
      parts.push(`[MEMORY]\n${this.files['brain/memory.md']}`);
    }

    if (userContext?.recentMessages?.length > 0) {
      const msgHistory = userContext.recentMessages
        .map(m => `${m.sender}: ${m.text}`)
        .join('\n');
      parts.push(`[RECENT CONVERSATION]\n${msgHistory}`);
    }

    parts.push(`[CURRENT MESSAGE]\nUser: ${incomingMessage}`);
    parts.push('[RESPONSE]');

    return parts.join('\n\n');
  }

  getFile(name) {
    return this.files[`brain/${name}.md`] || null;
  }

  updateFile(name, content) {
    const filePath = path.resolve(`brain/${name}.md`);
    fs.writeFileSync(filePath, content, 'utf-8');
    this.files[`brain/${name}.md`] = content;
  }

  watch(callback) {
    const brainFiles = (this.config.brainFiles || []).map(f => path.resolve(f));
    
    this.watcher = chokidar.watch(brainFiles, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
    });

    this.watcher.on('change', (file) => {
      console.log('📝 Brain file changed:', path.basename(file));
      this.loadAll();
      callback && callback(file);
    });

    this.watcher.on('add', (file) => {
      console.log('📝 Brain file added:', path.basename(file));
      this.loadAll();
    });
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

module.exports = BrainLoader;