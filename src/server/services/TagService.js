const fs = require('fs');
const path = require('path');
const { generateId } = require('../utils/id');

class TagService {
  static _indexPath = null;
  static _tags = [];

  static init(workspaceRoot) {
    TagService._indexPath = path.join(workspaceRoot, 'WORKFLOWS', 'tags.json');
    TagService._load();
  }

  static _load() {
    try {
      if (fs.existsSync(TagService._indexPath)) {
        TagService._tags = JSON.parse(fs.readFileSync(TagService._indexPath, 'utf-8'));
      } else {
        TagService._tags = [];
        TagService._save();
      }
    } catch (e) { TagService._tags = []; }
  }

  static _save() {
    try { fs.writeFileSync(TagService._indexPath, JSON.stringify(TagService._tags, null, 2)); } catch (e) {}
  }

  static create(name, color) {
    if (TagService._tags.find(t => t.name === name)) return null;
    const tag = { id: generateId(), name, color: color || '#6366f1', createdAt: new Date().toISOString() };
    TagService._tags.push(tag);
    TagService._save();
    return tag;
  }

  static delete(id) {
    const idx = TagService._tags.findIndex(t => t.id === id);
    if (idx === -1) return false;
    TagService._tags.splice(idx, 1);
    TagService._save();
    return true;
  }

  static list() { return TagService._tags; }
}
module.exports = TagService;
