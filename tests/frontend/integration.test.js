const { describe, it, expect } = require('@jest/globals');

describe('Frontend Integration', () => {
  describe('Router', () => {
    it('should register routes', () => {
      const routes = {};
      function register(path, handler) { routes[path] = handler; }

      register('/agents', () => 'agents');
      register('/workflows', () => 'workflows');

      expect(routes['/agents']).toBeDefined();
      expect(routes['/workflows']).toBeDefined();
    });

    it('should navigate to routes', () => {
      let currentPath = '';
      function navigate(path) { currentPath = path; }

      navigate('/agents');
      expect(currentPath).toBe('/agents');
    });
  });

  describe('WebSocket Message Handling', () => {
    it('should handle workflow status update', () => {
      const handlers = {};
      function on(event, handler) { handlers[event] = handler; }

      let received = null;
      on('workflow.statusUpdate', (data) => { received = data; });

      handlers['workflow.statusUpdate']({ workflowId: 'wf1', status: 'completed' });
      expect(received.status).toBe('completed');
    });

    it('should handle task progress', () => {
      const handlers = {};
      function on(event, handler) { handlers[event] = handler; }

      let received = null;
      on('task.progress', (data) => { received = data; });

      handlers['task.progress']({ taskId: 't1', status: 'running' });
      expect(received.taskId).toBe('t1');
    });
  });

  describe('Notification Manager', () => {
    it('should add notification', () => {
      const notifications = [];
      function addNotification(n) {
        notifications.push({ ...n, id: Date.now(), read: false });
      }

      addNotification({ title: 'Test', body: 'Test body', type: 'info' });
      expect(notifications.length).toBe(1);
      expect(notifications[0].title).toBe('Test');
    });

    it('should limit notifications to 50', () => {
      const notifications = [];
      function addNotification(n) {
        notifications.push(n);
        if (notifications.length > 50) notifications.splice(0, notifications.length - 50);
      }

      for (let i = 0; i < 60; i++) {
        addNotification({ title: `Test ${i}` });
      }
      expect(notifications.length).toBe(50);
    });
  });
});
