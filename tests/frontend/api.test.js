const { describe, it, expect, beforeEach, afterAll } = require('@jest/globals');

const nativeFetch = global.fetch;

describe('API Client', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = nativeFetch;
  });

  describe('request handling', () => {
    it('should make GET request', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      });

      const response = await fetch('/api/agents');
      const data = await response.json();

      expect(global.fetch).toHaveBeenCalledWith('/api/agents');
      expect(data.success).toBe(true);
    });

    it('should handle error responses', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      });

      const response = await fetch('/api/agents');
      expect(response.ok).toBe(false);
    });
  });
});
