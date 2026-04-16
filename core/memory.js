const fs = require('fs');
const path = require('path');

class MemoryStore {
  constructor(config) {
    this.config = config;
    this.maxMessages = config.maxMemoryMessages || 5;
    this.userMemories = new Map();
    this.memoryFile = 'brain/memory.md';
  }

  addMessage(userId, sender, text) {
    if (!this.userMemories.has(userId)) {
      this.userMemories.set(userId, []);
    }

    const messages = this.userMemories.get(userId);
    messages.push({ sender, text, timestamp: Date.now() });

    if (messages.length > this.maxMessages) {
      messages.shift();
    }
  }

  getRecentMessages(userId) {
    return this.userMemories.get(userId) || [];
  }

  async addMemory(userId, text) {
    const currentMemory = this.getMemoryContent();
    const newMemory = currentMemory + `\n- ${text}`;
    fs.writeFileSync(this.memoryFile, newMemory, 'utf-8');
    return 'Memory added!';
  }

  getMemoryContent() {
    if (fs.existsSync(this.memoryFile)) {
      return fs.readFileSync(this.memoryFile, 'utf-8');
    }
    return '';
  }

  clearMemory() {
    fs.writeFileSync(this.memoryFile, '# Memory\n\nUser memories:\n', 'utf-8');
    return 'Memory cleared!';
  }

  removeUser(userId) {
    this.userMemories.delete(userId);
  }

  getUserIds() {
    return Array.from(this.userMemories.keys());
  }

  serialize() {
    const data = {};
    for (const [userId, messages] of this.userMemories) {
      data[userId] = messages;
    }
    return data;
  }

  load(data) {
    for (const [userId, messages] of Object.entries(data)) {
      this.userMemories.set(userId, messages);
    }
  }
}

module.exports = MemoryStore;