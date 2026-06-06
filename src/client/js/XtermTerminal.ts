// ═══════════════════════════════════════════════
// XtermTerminal — Shared xterm.js wrapper
// ═══════════════════════════════════════════════

interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

interface TerminalInstance {
  terminal: any;
  fitAddon: any;
  disposables: (() => void)[];
  _inputCallback?: (data: string) => void;
}

interface FitDimensions {
  cols: number;
  rows: number;
}

interface XtermTerminalAPI {
  create(sessionId: string, container: HTMLElement): TerminalInstance | null;
  write(sessionId: string, data: string): void;
  onInput(sessionId: string, callback: (data: string) => void): void;
  fit(sessionId: string): void;
  fitAll(): void;
  focus(sessionId: string): void;
  clear(sessionId: string): void;
  destroy(sessionId: string): void;
  destroyAll(): void;
  has(sessionId: string): boolean;
}

(window as any).XtermTerminal = ((): XtermTerminalAPI => {
  /** Map of session IDs to terminal instances */
  const instances = new Map<string, TerminalInstance>();

  /** Pending create calls waiting for xterm to load */
  let _pendingCreates: (() => void)[] = [];

  // ── Theme definitions ──
  const THEMES: Record<string, TerminalTheme> = {
    dark: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#585b7066',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8',
    },
    light: {
      background: '#ffffff',
      foreground: '#1a1a1a',
      cursor: '#333333',
      selectionBackground: '#b4d5fe66',
      black: '#1a1a1a',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#d97706',
      blue: '#2563eb',
      magenta: '#7c3aed',
      cyan: '#0891b2',
      white: '#555555',
      brightBlack: '#888888',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#f59e0b',
      brightBlue: '#3b82f6',
      brightMagenta: '#8b5cf6',
      brightCyan: '#06b6d4',
      brightWhite: '#1a1a1a',
    }
  };

  function _getTheme(): string {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function _isReady(): boolean {
    return !!((window as any).Terminal && (window as any).FitAddon);
  }

  // When xterm.js module finishes loading, retry pending creates
  window.addEventListener('xterm-ready', () => {
    const pending = _pendingCreates;
    _pendingCreates = [];
    pending.forEach(fn => fn());
  });

  // Watch for theme changes on <html data-theme="...">
  const _themeObserver = new MutationObserver(() => {
    const themeName = _getTheme();
    const theme = THEMES[themeName];
    for (const [, entry] of instances) {
      try { entry.terminal.options.theme = theme; } catch (e) { /* ignore */ }
    }
  });
  _themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /**
   * Create an xterm.js terminal instance for a session
   * @param sessionId - The session identifier
   * @param container - DOM element to attach to
   * @returns The terminal instance or null if xterm is not yet loaded
   */
  function create(sessionId: string, container: HTMLElement): TerminalInstance | null {
    if (instances.has(sessionId)) {
      const existing = instances.get(sessionId)!;
      if (existing.terminal.element && existing.terminal.element.parentElement !== container) {
        container.appendChild(existing.terminal.element);
      }
      existing.fitAddon.fit();
      return existing;
    }

    if (!_isReady()) {
      _pendingCreates.push(() => create(sessionId, container));
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">加载终端组件中...</div>';
      return null;
    }

    const theme = THEMES[_getTheme()];
    const terminal = new (window as any).Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme,
      scrollback: 5000,
    });

    const fitAddon = new (window as any).FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(container);
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch (e) { /* ignore */ }
    });

    // Ctrl+Enter: insert newline without executing
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter' && e.type === 'keydown') {
        terminal.write('\n');
        // Also send newline to server PTY
        const entry = instances.get(sessionId);
        if (entry?._inputCallback) {
          entry._inputCallback('\n');
        }
        return false; // prevent default handling
      }
      return true; // let xterm handle everything else
    });

    // Notify backend PTY when terminal size changes
    let lastCols = 0, lastRows = 0;
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const dims: FitDimensions | undefined = fitAddon.proposeDimensions();
        if (dims && (dims.cols !== lastCols || dims.rows !== lastRows)) {
          lastCols = dims.cols;
          lastRows = dims.rows;
          API.resizeTerminal(sessionId, dims.cols, dims.rows).catch(() => {});
        }
      } catch (e) { /* ignore */ }
    });
    resizeObserver.observe(container);

    const entry: TerminalInstance = { terminal, fitAddon, disposables: [() => resizeObserver.disconnect()] };
    instances.set(sessionId, entry);

    return entry;
  }

  /**
   * Write data from server to terminal
   * @param sessionId - The session identifier
   * @param data - The data to write
   */
  function write(sessionId: string, data: string): void {
    const entry = instances.get(sessionId);
    if (entry) {
      entry.terminal.write(data);
    }
  }

  /**
   * Register a callback for user input (typing in terminal)
   * @param sessionId - The session identifier
   * @param callback - Receives the input data string
   */
  function onInput(sessionId: string, callback: (data: string) => void): void {
    const entry = instances.get(sessionId);
    if (entry) {
      entry._inputCallback = callback;
      const disposable = entry.terminal.onData(callback);
      entry.disposables.push(() => disposable.dispose());
    }
  }

  /**
   * Fit terminal to container size
   * @param sessionId - The session identifier
   */
  function fit(sessionId: string): void {
    const entry = instances.get(sessionId);
    if (entry) {
      try { entry.fitAddon.fit(); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Fit all terminals
   */
  function fitAll(): void {
    for (const [, entry] of instances) {
      try { entry.fitAddon.fit(); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Focus a terminal
   * @param sessionId - The session identifier
   */
  function focus(sessionId: string): void {
    const entry = instances.get(sessionId);
    if (entry) {
      entry.terminal.focus();
    }
  }

  /**
   * Clear a terminal
   * @param sessionId - The session identifier
   */
  function clear(sessionId: string): void {
    const entry = instances.get(sessionId);
    if (entry) {
      entry.terminal.clear();
    }
  }

  /**
   * Destroy a terminal instance
   * @param sessionId - The session identifier
   */
  function destroy(sessionId: string): void {
    const entry = instances.get(sessionId);
    if (entry) {
      entry.disposables.forEach(fn => fn());
      entry.terminal.dispose();
      instances.delete(sessionId);
    }
  }

  /**
   * Destroy all terminals
   */
  function destroyAll(): void {
    for (const sessionId of instances.keys()) {
      destroy(sessionId);
    }
  }

  /**
   * Check if a terminal instance exists
   * @param sessionId - The session identifier
   * @returns Whether an instance exists for the session
   */
  function has(sessionId: string): boolean {
    return instances.has(sessionId);
  }

  return { create, write, onInput, fit, fitAll, focus, clear, destroy, destroyAll, has };
})();
