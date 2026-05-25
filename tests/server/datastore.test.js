const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DataStore = require('../../src/server/utils/DataStore');

let tempDir;
let testFile;

function setup() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'datastore-test-'));
  testFile = path.join(tempDir, 'test.json');
}

function cleanup() {
  if (fs.existsSync(tempDir)) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Cleanup failed:', err.message);
    }
  }
}

describe('DataStore', () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    cleanup();
  });

  describe('load()', () => {
    it('should return empty array when file does not exist', () => {
      const store = new DataStore(testFile);
      const result = store.load();
      assert.deepStrictEqual(result, []);
    });

    it('should load data from existing file', () => {
      const data = [{ id: '1', name: 'test' }];
      fs.writeFileSync(testFile, JSON.stringify(data), 'utf-8');

      const store = new DataStore(testFile);
      const result = store.load();
      assert.deepStrictEqual(result, data);
    });

    it('should return empty array for invalid JSON', () => {
      fs.writeFileSync(testFile, 'not valid json{{{', 'utf-8');

      const store = new DataStore(testFile);
      const result = store.load();
      assert.deepStrictEqual(result, []);
    });

    it('should return empty array for empty file', () => {
      fs.writeFileSync(testFile, '', 'utf-8');

      const store = new DataStore(testFile);
      const result = store.load();
      assert.deepStrictEqual(result, []);
    });
  });

  describe('save()', () => {
    it('should save data to file', () => {
      const store = new DataStore(testFile);
      const data = [{ id: '1', name: 'test' }];
      store.save(data);

      assert.ok(fs.existsSync(testFile));
      const loaded = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
      assert.deepStrictEqual(loaded, data);
    });

    it('should create directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', 'deep');
      const nestedFile = path.join(nestedDir, 'data.json');

      const store = new DataStore(nestedFile);
      store.save([{ id: '1' }]);

      assert.ok(fs.existsSync(nestedFile));
    });

    it('should overwrite existing data', () => {
      const store = new DataStore(testFile);

      store.save([{ id: '1', name: 'first' }]);
      store.save([{ id: '2', name: 'second' }]);

      const loaded = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0].name, 'second');
    });

    it('should save empty array', () => {
      const store = new DataStore(testFile);
      store.save([]);

      const loaded = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
      assert.deepStrictEqual(loaded, []);
    });

    it('should format JSON with indentation', () => {
      const store = new DataStore(testFile);
      store.save([{ id: '1' }]);

      const raw = fs.readFileSync(testFile, 'utf-8');
      assert.ok(raw.includes('\n'), 'JSON should be pretty-printed');
    });
  });
});
