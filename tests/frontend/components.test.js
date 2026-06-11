const { describe, it, expect } = require('@jest/globals');

describe('StatusBadge', () => {
  function renderStatusBadge(status) {
    const config = {
      pending: { color: 'var(--text-muted)', text: '等待中' },
      running: { color: 'var(--accent-cyan)', text: '运行中' },
      completed: { color: 'var(--accent-green)', text: '已完成' },
      failed: { color: 'var(--accent-red)', text: '失败' },
    };
    const cfg = config[status] || config.pending;
    return `<span style="color:${cfg.color}">${cfg.text}</span>`;
  }

  it('should render pending status', () => {
    expect(renderStatusBadge('pending')).toContain('等待中');
  });

  it('should render running status', () => {
    expect(renderStatusBadge('running')).toContain('运行中');
  });

  it('should render completed status', () => {
    expect(renderStatusBadge('completed')).toContain('已完成');
  });

  it('should render failed status', () => {
    expect(renderStatusBadge('failed')).toContain('失败');
  });

  it('should default to pending for unknown status', () => {
    expect(renderStatusBadge('unknown')).toContain('等待中');
  });
});

describe('Cache', () => {
  class Cache {
    constructor() { this._cache = new Map(); }
    set(key, value, ttl = 300000) {
      this._cache.set(key, { value, expires: Date.now() + ttl });
    }
    get(key) {
      const item = this._cache.get(key);
      if (!item) return null;
      if (Date.now() > item.expires) { this._cache.delete(key); return null; }
      return item.value;
    }
    has(key) { return this.get(key) !== null; }
    remove(key) { this._cache.delete(key); }
    clear() { this._cache.clear(); }
  }

  it('should store and retrieve values', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return null for missing keys', () => {
    const cache = new Cache();
    expect(cache.get('missing')).toBeNull();
  });

  it('should expire after TTL', async () => {
    const cache = new Cache();
    cache.set('key1', 'value1', 50);
    expect(cache.get('key1')).toBe('value1');
    await new Promise(r => setTimeout(r, 100));
    expect(cache.get('key1')).toBeNull();
  });

  it('should check existence', () => {
    const cache = new Cache();
    expect(cache.has('key1')).toBe(false);
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);
  });

  it('should remove entries', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    cache.remove('key1');
    expect(cache.get('key1')).toBeNull();
  });

  it('should clear all entries', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();
    expect(cache.get('key1')).toBeNull();
    expect(cache.get('key2')).toBeNull();
  });
});

describe('FeedbackForm', () => {
  function createFeedbackForm({ targetId, targetType, onSubmit }) {
    let selectedRating = null;
    let comment = '';

    function selectRating(rating) {
      selectedRating = rating;
    }

    function setComment(value) {
      comment = value;
    }

    function getFormData() {
      return {
        targetId,
        targetType,
        rating: selectedRating,
        comment: comment || undefined
      };
    }

    function canSubmit() {
      return selectedRating !== null;
    }

    return { selectRating, setComment, getFormData, canSubmit };
  }

  it('should not submit without rating', () => {
    const form = createFeedbackForm({ targetId: '123', targetType: 'agent' });
    expect(form.canSubmit()).toBe(false);
  });

  it('should submit with thumbs up rating', () => {
    const form = createFeedbackForm({ targetId: '123', targetType: 'agent' });
    form.selectRating('thumbs_up');
    expect(form.canSubmit()).toBe(true);
    expect(form.getFormData().rating).toBe('thumbs_up');
  });

  it('should submit with thumbs down rating', () => {
    const form = createFeedbackForm({ targetId: '123', targetType: 'agent' });
    form.selectRating('thumbs_down');
    expect(form.canSubmit()).toBe(true);
    expect(form.getFormData().rating).toBe('thumbs_down');
  });

  it('should include comment when provided', () => {
    const form = createFeedbackForm({ targetId: '123', targetType: 'agent' });
    form.selectRating('thumbs_up');
    form.setComment('Great work!');
    expect(form.getFormData().comment).toBe('Great work!');
  });

  it('should have undefined comment when empty', () => {
    const form = createFeedbackForm({ targetId: '123', targetType: 'agent' });
    form.selectRating('thumbs_up');
    expect(form.getFormData().comment).toBeUndefined();
  });
});

describe('FeedbackList', () => {
  function filterFeedback(feedback, filters) {
    let result = [...feedback];

    if (filters.targetType) {
      result = result.filter(f => f.targetType === filters.targetType);
    }

    if (filters.rating) {
      result = result.filter(f => f.rating === filters.rating);
    }

    return result;
  }

  function paginateFeedback(feedback, page, limit) {
    const startIndex = (page - 1) * limit;
    return feedback.slice(startIndex, startIndex + limit);
  }

  const mockFeedback = [
    { id: '1', targetType: 'agent', rating: 'thumbs_up', comment: 'Good' },
    { id: '2', targetType: 'task', rating: 'thumbs_down', comment: 'Bad' },
    { id: '3', targetType: 'agent', rating: 'thumbs_up', comment: 'Great' },
    { id: '4', targetType: 'workflow', rating: 'thumbs_up', comment: 'Excellent' },
  ];

  it('should filter by targetType', () => {
    const filtered = filterFeedback(mockFeedback, { targetType: 'agent' });
    expect(filtered.length).toBe(2);
    filtered.forEach(f => {
      expect(f.targetType).toBe('agent');
    });
  });

  it('should filter by rating', () => {
    const filtered = filterFeedback(mockFeedback, { rating: 'thumbs_down' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].rating).toBe('thumbs_down');
  });

  it('should paginate results', () => {
    const paginated = paginateFeedback(mockFeedback, 1, 2);
    expect(paginated.length).toBe(2);
    expect(paginated[0].id).toBe('1');
    expect(paginated[1].id).toBe('2');
  });

  it('should handle pagination beyond available data', () => {
    const paginated = paginateFeedback(mockFeedback, 10, 10);
    expect(paginated.length).toBe(0);
  });
});

describe('FeedbackStats', () => {
  function computeStats(feedback) {
    const total = feedback.length;
    const thumbsUp = feedback.filter(f => f.rating === 'thumbs_up').length;
    const thumbsDown = feedback.filter(f => f.rating === 'thumbs_down').length;
    const positiveRate = total > 0 ? (thumbsUp / total) * 100 : 0;

    return {
      total,
      thumbsUp,
      thumbsDown,
      positiveRate: Math.round(positiveRate * 10) / 10
    };
  }

  it('should compute correct stats', () => {
    const feedback = [
      { rating: 'thumbs_up' },
      { rating: 'thumbs_up' },
      { rating: 'thumbs_down' },
    ];
    const stats = computeStats(feedback);
    expect(stats.total).toBe(3);
    expect(stats.thumbsUp).toBe(2);
    expect(stats.thumbsDown).toBe(1);
    expect(stats.positiveRate).toBe(66.7);
  });

  it('should handle empty feedback', () => {
    const stats = computeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.thumbsUp).toBe(0);
    expect(stats.thumbsDown).toBe(0);
    expect(stats.positiveRate).toBe(0);
  });

  it('should compute 100% positive rate when all thumbs up', () => {
    const feedback = [
      { rating: 'thumbs_up' },
      { rating: 'thumbs_up' },
    ];
    const stats = computeStats(feedback);
    expect(stats.positiveRate).toBe(100.0);
  });

  it('should compute 0% positive rate when all thumbs down', () => {
    const feedback = [
      { rating: 'thumbs_down' },
      { rating: 'thumbs_down' },
    ];
    const stats = computeStats(feedback);
    expect(stats.positiveRate).toBe(0.0);
  });
});
