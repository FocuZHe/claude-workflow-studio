const { describe, it, expect, beforeEach } = require('@jest/globals');

describe('Store', () => {
  class Store {
    constructor() { this._data = {}; }
    get(key) { return this._data[key]; }
    set(key, value) { this._data[key] = value; }
    remove(key) { delete this._data[key]; }
    clear() { this._data = {}; }
  }

  let store;
  beforeEach(() => {
    store = new Store();
  });

  it('should store values', () => {
    store.set('key', 'value');
    expect(store.get('key')).toBe('value');
  });

  it('should overwrite values', () => {
    store.set('key', 'value1');
    store.set('key', 'value2');
    expect(store.get('key')).toBe('value2');
  });

  it('should return undefined for missing keys', () => {
    expect(store.get('missing')).toBeUndefined();
  });

  it('should remove values', () => {
    store.set('key', 'value');
    store.remove('key');
    expect(store.get('key')).toBeUndefined();
  });

  it('should clear all values', () => {
    store.set('key1', 'value1');
    store.set('key2', 'value2');
    store.clear();
    expect(store.get('key1')).toBeUndefined();
    expect(store.get('key2')).toBeUndefined();
  });
});
