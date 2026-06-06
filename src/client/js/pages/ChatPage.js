"use strict";
// ═══════════════════════════════════════════════
// Chat Page — AI Conversation Panel
// ═══════════════════════════════════════════════
window.ChatPage = (() => {
    let sessions = [];
    let activeSessionId = null;
    const streamingState = new Map(); // sessionId -> { isStreaming, streamBuffer }
    function getStreamingState(sessionId) {
        if (!streamingState.has(sessionId)) {
            streamingState.set(sessionId, { isStreaming: false, streamBuffer: '' });
        }
        return streamingState.get(sessionId);
    }
    let _cleanupFns = [];
    let activeSessionMeta = null;
    let _editingTitle = false;
    let _clickTimer = null;
    const STORAGE_KEY = 'chat-active-session';
    let _searchSeq = 0;
    let slashIndex = -1;
    const SLASH_COMMANDS = [
        { cmd: '/help', desc: '显示可用命令', usage: '/help' },
        { cmd: '/clear', desc: '清空当前对话', usage: '/clear' },
        { cmd: '/compact', desc: '压缩对话历史（摘要旧消息以节省上下文）', usage: '/compact [可选摘要]' },
        { cmd: '/model', desc: '查看或切换模型', usage: '/model [模型名]' },
        { cmd: '/system', desc: '查看或设置系统提示词', usage: '/system [提示词]' },
        { cmd: '/config', desc: '查看或修改会话配置', usage: '/config [key] [value]' },
        { cmd: '/status', desc: '显示会话状态信息', usage: '/status' },
        { cmd: '/memory', desc: '编辑系统提示词（CLAUDE.md 风格）', usage: '/memory [内容]' },
        { cmd: '/export', desc: '导出对话记录到剪贴板', usage: '/export' },
        { cmd: '/archive', desc: '归档当前对话', usage: '/archive' },
        { cmd: '/delete', desc: '删除当前对话', usage: '/delete' },
        { cmd: '/review', desc: '请求 AI 审查代码', usage: '/review [文件路径或描述]' },
        { cmd: '/bug', desc: '报告问题', usage: '/bug [描述]' },
    ];
    async function render() {
        const el = document.getElementById('content');
        el.innerHTML = `
      <div class="page-enter" style="display:flex;flex-direction:column;">
        <div class="page-header" style="flex-shrink:0;">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('chat', 20)}</span> 对话</h1>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" id="chat-new-btn">+ 新对话</button>
            <button class="btn btn-secondary" id="chat-archive-btn">归档当前</button>
          </div>
        </div>
        <div style="display:flex;flex:1;gap:0;overflow:hidden;border:1px solid var(--border-subtle);border-radius:var(--border-radius-lg);">
          <!-- Session list sidebar -->
          <div id="chat-sidebar" class="terminal-sidebar">
            <div style="padding:8px;border-bottom:1px solid var(--border-subtle);">
              <input class="input" id="chat-search-input" placeholder="搜索会话内容..." style="width:100%;font-size:12px;">
            </div>
            <div id="chat-session-list" style="flex:1;overflow-y:auto;"></div>
          </div>
          <!-- Chat area -->
          <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg-primary);">
            <div id="chat-messages" style="flex:1;overflow-y:auto;padding:16px;">
              ${EmptyState.render({ icon: Icon.svg('chat', 40), title: '开始新对话', description: '与 AI 助手对话，获取编程知识、技术方案和问题解答' })}
            </div>
            <div id="chat-input-area" class="chat-input-area">
              <div id="slash-dropdown" class="slash-dropdown"></div>
              <div style="display:flex;gap:8px;align-items:flex-end;">
                <textarea class="input" id="chat-input" placeholder="输入消息... (Enter 发送, Shift+Enter 换行, / 查看命令)" rows="1" style="flex:1;resize:none;min-height:40px;max-height:120px;font-size:13px;line-height:1.5;"></textarea>
                <button class="btn btn-primary" id="chat-send-btn" style="flex-shrink:0;height:40px;">发送</button>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:var(--text-muted);">
                <span id="chat-slash-hint">输入 / 查看斜杠命令</span>
                <span id="chat-model-info">模型: 默认</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
        document.getElementById('chat-new-btn').addEventListener('click', createSession);
        document.getElementById('chat-archive-btn').addEventListener('click', archiveCurrentSession);
        document.getElementById('chat-send-btn').addEventListener('click', sendMessage);
        document.getElementById('chat-search-input').addEventListener('input', debounce(searchSessions, 300));
        const input = document.getElementById('chat-input');
        input.addEventListener('keydown', (e) => {
            const dropdown = document.getElementById('slash-dropdown');
            const isOpen = dropdown !== null && dropdown.style.display !== 'none';
            if (isOpen) {
                const items = dropdown.querySelectorAll('.slash-item');
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    slashIndex = Math.min(slashIndex + 1, items.length - 1);
                    updateSlashSelection(items, slashIndex);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    slashIndex = Math.max(slashIndex - 1, 0);
                    updateSlashSelection(items, slashIndex);
                    return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (slashIndex >= 0 && items[slashIndex]) {
                        selectSlashCommand(items[slashIndex].dataset.cmd);
                    }
                    else if (items.length > 0) {
                        selectSlashCommand(items[0].dataset.cmd);
                    }
                    return;
                }
                if (e.key === 'Escape') {
                    closeSlashDropdown();
                    return;
                }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        input.addEventListener('input', () => {
            autoResizeInput();
            handleSlashDropdown();
        });
        // Load sessions
        await loadSessions();
        // Restore active session
        const savedId = localStorage.getItem(STORAGE_KEY);
        if (savedId && sessions.find((s) => s.id === savedId)) {
            switchSession(savedId);
        }
        // Register WebSocket listener for chat stream
        const streamHandler = async (payload) => {
            if (!activeSessionId || payload.sessionId !== activeSessionId)
                return;
            if (payload.done) {
                getStreamingState(payload.sessionId).isStreaming = false;
                getStreamingState(payload.sessionId).streamBuffer = '';
                updateSendButton();
                await loadMessages(activeSessionId); // reload persisted messages from backend
                loadSessions(); // refresh session list
            }
            else if (payload.chunk) {
                const state = getStreamingState(payload.sessionId);
                state.streamBuffer += payload.chunk;
                appendStreamingMessage(payload.sessionId, state.streamBuffer);
            }
        };
        WS.on('chat.stream', streamHandler);
        _cleanupFns.push(() => WS.off('chat.stream', streamHandler));
        // Confirmation handler for AI actions
        const confirmHandler = async (payload) => {
            if (!activeSessionId || payload.sessionId !== activeSessionId)
                return;
            const confirmed = await Modal.confirm('AI 请求执行操作', `AI 想要执行以下操作，是否允许？\n\n类型: ${payload.type === 'write' ? '写入文件' : '执行命令'}\n${payload.description || ''}`);
            try {
                await API.post(`/chat/${activeSessionId}/execute`, {
                    actionId: payload.actionId,
                    confirmed,
                    type: payload.type,
                    data: payload.data
                });
                if (confirmed) {
                    Toast.success('操作已执行');
                    // Reload messages to show the result
                    await loadMessages(activeSessionId);
                }
                else {
                    Toast.info('操作已拒绝');
                }
            }
            catch (e) {
                Toast.error(e.message || '执行失败');
            }
        };
        WS.on('chat.confirmAction', confirmHandler);
        _cleanupFns.push(() => WS.off('chat.confirmAction', confirmHandler));
        // Title update handler — refresh sidebar when server updates session title
        const titleHandler = (payload) => {
            if (payload.sessionId) {
                const session = sessions.find((s) => s.id === payload.sessionId);
                if (session)
                    session.title = payload.title;
                if (activeSessionMeta && activeSessionId === payload.sessionId) {
                    activeSessionMeta.title = payload.title;
                }
                renderSessionList();
            }
        };
        WS.on('chat.titleUpdated', titleHandler);
        _cleanupFns.push(() => WS.off('chat.titleUpdated', titleHandler));
    }
    function cleanup() {
        _cleanupFns.forEach((fn) => fn());
        _cleanupFns = [];
    }
    function autoResizeInput() {
        const input = document.getElementById('chat-input');
        if (!input)
            return;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }
    function updateModelInfo() {
        const el = document.getElementById('chat-model-info');
        if (el && activeSessionMeta) {
            el.textContent = '模型: ' + (activeSessionMeta.model || '默认');
        }
    }
    function handleSlashDropdown() {
        const input = document.getElementById('chat-input');
        const dropdown = document.getElementById('slash-dropdown');
        if (!input || !dropdown)
            return;
        const val = input.value;
        if (!val.startsWith('/')) {
            closeSlashDropdown();
            return;
        }
        const query = val.toLowerCase();
        const matches = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(query) || c.desc.toLowerCase().includes(query.slice(1)));
        if (matches.length === 0) {
            closeSlashDropdown();
            return;
        }
        slashIndex = 0;
        dropdown.innerHTML = matches.map((c, i) => `
      <div class="slash-dropdown-item slash-item ${i === 0 ? 'selected' : ''}" data-cmd="${c.cmd}">
        <div>
          <span style="font-weight:600;color:var(--accent-blue);">${c.cmd}</span>
          <span style="color:var(--text-muted);margin-left:8px;font-size:12px;">${c.desc}</span>
        </div>
        <span style="font-size:11px;color:var(--text-tertiary);">${c.usage}</span>
      </div>
    `).join('');
        dropdown.querySelectorAll('.slash-item').forEach((el) => {
            const htmlEl = el;
            htmlEl.addEventListener('click', () => selectSlashCommand(htmlEl.dataset.cmd));
            htmlEl.addEventListener('mouseenter', () => {
                dropdown.querySelectorAll('.slash-item').forEach((s) => {
                    s.classList.remove('selected');
                });
                htmlEl.classList.add('selected');
                slashIndex = Array.from(dropdown.children).indexOf(htmlEl);
            });
        });
        dropdown.style.display = 'block';
    }
    function updateSlashSelection(items, idx) {
        items.forEach((el, i) => {
            el.classList.toggle('selected', i === idx);
        });
    }
    function selectSlashCommand(cmd) {
        const input = document.getElementById('chat-input');
        if (input) {
            input.value = cmd + ' ';
            input.focus();
            autoResizeInput();
        }
        closeSlashDropdown();
    }
    function closeSlashDropdown() {
        const dropdown = document.getElementById('slash-dropdown');
        if (dropdown)
            dropdown.style.display = 'none';
        slashIndex = -1;
    }
    function updateSendButton() {
        const btn = document.getElementById('chat-send-btn');
        if (!btn)
            return;
        const streaming = activeSessionId ? getStreamingState(activeSessionId).isStreaming : false;
        btn.disabled = streaming;
        btn.textContent = streaming ? '生成中...' : '发送';
    }
    async function loadSessions() {
        try {
            const res = await API.get('/chat', { status: 'active' });
            sessions = res.data?.items || res.data || [];
            renderSessionList();
        }
        catch (e) {
            console.warn('加载对话列表失败:', e.message);
        }
    }
    async function searchSessions() {
        const query = document.getElementById('chat-search-input')?.value.trim() || '';
        if (!query) {
            renderSessionList(sessions);
            return;
        }
        const seq = ++_searchSeq;
        try {
            const res = await API.searchChatSessions(query);
            if (seq !== _searchSeq)
                return;
            const results = res.data || [];
            renderSearchResults(results);
        }
        catch (e) {
            if (seq !== _searchSeq)
                return;
            Toast.error('搜索失败: ' + e.message);
        }
    }
    function renderSearchResults(results) {
        const listEl = document.getElementById('chat-session-list');
        if (!listEl)
            return;
        if (results.length === 0) {
            listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;">未找到匹配结果</div>';
            return;
        }
        listEl.innerHTML = results.map((r) => `
      <div class="session-item" data-id="${r.id}" style="padding:10px 12px;border-bottom:1px solid var(--border-subtle);cursor:pointer;">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${escapeHtml(r.title)}</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;">${r.matchCount} 条匹配</div>
        ${r.matches.slice(0, 2).map((m) => `
          <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${escapeHtml(m.content)}
          </div>
        `).join('')}
      </div>
    `).join('');
        listEl.querySelectorAll('.session-item').forEach((item) => {
            const htmlItem = item;
            htmlItem.addEventListener('click', () => switchSession(htmlItem.dataset.id));
        });
    }
    function renderSessionList(list) {
        const container = document.getElementById('chat-session-list');
        if (!container)
            return;
        const items = list || sessions;
        if (items.length === 0) {
            container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;">暂无对话</div>';
            return;
        }
        container.innerHTML = items.map((s) => {
            const isActive = s.id === activeSessionId;
            const lastMsg = s.messages?.length > 0 ? s.messages[s.messages.length - 1] : null;
            const preview = lastMsg ? (lastMsg.content || '').substring(0, 40) : '空对话';
            return `
        <div class="chat-session-item ${isActive ? 'active' : ''}" data-id="${s.id}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border-subtle);transition:background 0.15s;position:relative;${isActive ? 'background:var(--bg-primary);border-left:3px solid var(--accent-blue);' : 'border-left:3px solid transparent;'}">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div class="session-title" data-id="${s.id}" style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);flex:1;cursor:text;">${escapeHtml(s.title || '新对话')}</div>
            <button class="session-delete-btn" data-id="${s.id}" title="删除对话" style="flex-shrink:0;width:20px;height:20px;border:none;background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:14px;line-height:20px;text-align:center;border-radius:4px;opacity:0;transition:opacity 0.15s,background 0.15s;padding:0;">${Icon.svg('close', 14)}</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(preview)}</div>
          <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px;">${formatDate(s.updatedAt || s.createdAt || '')}</div>
        </div>
      `;
        }).join('');
        container.querySelectorAll('.chat-session-item').forEach((el) => {
            const htmlEl = el;
            htmlEl.addEventListener('click', () => {
                if (_editingTitle)
                    return;
                if (_clickTimer)
                    clearTimeout(_clickTimer);
                _clickTimer = setTimeout(() => switchSession(htmlEl.dataset.id), 250);
            });
            htmlEl.addEventListener('mouseenter', () => {
                const delBtn = htmlEl.querySelector('.session-delete-btn');
                if (delBtn)
                    delBtn.style.opacity = '1';
            });
            htmlEl.addEventListener('mouseleave', () => {
                const delBtn = htmlEl.querySelector('.session-delete-btn');
                if (delBtn)
                    delBtn.style.opacity = '0';
            });
        });
        container.querySelectorAll('.session-title').forEach((titleEl) => {
            const htmlTitleEl = titleEl;
            htmlTitleEl.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (_clickTimer)
                    clearTimeout(_clickTimer);
                _editingTitle = true;
                const sid = htmlTitleEl.dataset.id;
                const currentTitle = htmlTitleEl.textContent || '';
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentTitle;
                input.className = 'input';
                input.style.cssText = 'font-size:13px;font-weight:600;padding:2px 6px;width:100%;height:24px;';
                htmlTitleEl.replaceWith(input);
                input.focus();
                input.select();
                const finishEdit = async () => {
                    const newTitle = input.value.trim();
                    if (newTitle && newTitle !== currentTitle) {
                        try {
                            await API.put(`/chat/${sid}`, { title: newTitle });
                            const session = sessions.find((s) => s.id === sid);
                            if (session)
                                session.title = newTitle;
                            if (activeSessionMeta && activeSessionId === sid) {
                                activeSessionMeta.title = newTitle;
                            }
                            Toast.success('标题已更新');
                        }
                        catch (err) {
                            Toast.error('重命名失败: ' + err.message);
                        }
                    }
                    _editingTitle = false;
                    renderSessionList();
                };
                input.addEventListener('blur', finishEdit);
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        input.blur();
                    }
                    if (ev.key === 'Escape') {
                        _editingTitle = false;
                        input.value = currentTitle;
                        input.blur();
                    }
                });
            });
        });
        container.querySelectorAll('.session-delete-btn').forEach((btn) => {
            const htmlBtn = btn;
            htmlBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sid = htmlBtn.dataset.id;
                const confirmed = await Modal.confirm('删除对话', '确定删除该对话？此操作不可恢复。');
                if (confirmed) {
                    try {
                        await API.del(`/chat/${sid}`);
                        Toast.success('对话已删除');
                        if (sid === activeSessionId) {
                            activeSessionId = null;
                            activeSessionMeta = null;
                            localStorage.removeItem(STORAGE_KEY);
                            const msgContainer = document.getElementById('chat-messages');
                            if (msgContainer) {
                                msgContainer.innerHTML = EmptyState.render({ icon: Icon.svg('chat', 40), title: '开始新对话', description: '与 AI 助手对话，获取编程知识、技术方案和问题解答' });
                            }
                        }
                        await loadSessions();
                    }
                    catch (err) {
                        Toast.error('删除失败: ' + err.message);
                    }
                }
            });
            htmlBtn.addEventListener('mouseenter', () => { htmlBtn.style.background = 'rgba(255,60,60,0.15)'; });
            htmlBtn.addEventListener('mouseleave', () => { htmlBtn.style.background = 'transparent'; });
        });
    }
    async function createSession() {
        try {
            const payload = { title: '对话 ' + new Date().toLocaleTimeString() };
            const globalModel = localStorage.getItem('chat.globalModel');
            if (globalModel)
                payload.model = globalModel;
            const res = await API.post('/chat', payload);
            const session = res.data;
            sessions.unshift(session);
            switchSession(session.id);
            await loadSessions();
            Toast.success('新对话已创建');
        }
        catch (e) {
            Toast.error('创建对话失败: ' + e.message);
        }
    }
    async function switchSession(id) {
        // Clean up old streaming DOM elements from the previous session
        const container = document.getElementById('chat-messages');
        const oldStreamingEl = container?.querySelector('.chat-message.streaming') ?? null;
        if (oldStreamingEl)
            oldStreamingEl.remove();
        activeSessionMeta = null;
        activeSessionId = id;
        localStorage.setItem(STORAGE_KEY, id);
        renderSessionList();
        await loadMessages(id);
    }
    async function loadMessages(sessionId) {
        try {
            const res = await API.get(`/chat/${sessionId}`);
            const session = res.data;
            activeSessionMeta = session;
            renderMessages(session.messages || []);
            updateModelInfo();
        }
        catch (e) {
            Toast.error('加载消息失败: ' + e.message);
        }
    }
    function renderMessages(messages) {
        const container = document.getElementById('chat-messages');
        if (!container)
            return;
        if (messages.length === 0) {
            container.innerHTML = EmptyState.render({ icon: Icon.svg('chat', 40), title: '开始对话', description: '输入消息开始与 AI 助手交流' });
            return;
        }
        container.innerHTML = messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isSystem = msg.role === 'system';
            return `
        <div class="chat-message ${isUser ? 'user' : isSystem ? 'system' : 'assistant'}" style="margin-bottom:12px;display:flex;justify-content:${isUser ? 'flex-end' : 'flex-start'};">
          <div style="max-width:75%;${isUser ? 'order:2;' : ''}">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;${isUser ? 'justify-content:flex-end;' : ''}">
              <span style="font-size:11px;font-weight:600;color:var(--text-secondary);">${isUser ? '你' : isSystem ? '系统' : 'AI'}</span>
              <span style="font-size:10px;color:var(--text-tertiary);">${formatTime(msg.timestamp || '')}</span>
            </div>
            <div class="${isUser ? 'chat-bubble-user' : isSystem ? 'chat-bubble-system' : 'chat-bubble-assistant'}">
              ${isSystem ? escapeHtml(msg.content) : renderMessageContent(msg.content)}
            </div>
          </div>
        </div>
      `;
        }).join('');
        scrollToBottom();
    }
    function renderMessageContent(content) {
        if (!content)
            return '';
        let html = escapeHtml(content);
        // Code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
            return `<pre style="background:var(--bg-deep);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px;margin:8px 0;"><code>${code}</code></pre>`;
        });
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-deep);padding:2px 5px;border-radius:3px;font-size:12px;">$1</code>');
        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        return html;
    }
    function appendStreamingMessage(sessionId, content) {
        const container = document.getElementById('chat-messages');
        if (!container)
            return;
        let streamEl = container.querySelector('.chat-message.streaming');
        if (!streamEl) {
            // Remove empty state if present
            const emptyState = container.querySelector('.empty-state');
            if (emptyState)
                emptyState.remove();
            // Add user message placeholder for the last sent message
            const userDiv = document.createElement('div');
            userDiv.className = 'chat-message user';
            userDiv.style.cssText = 'margin-bottom:12px;display:flex;justify-content:flex-end;';
            container.appendChild(userDiv);
            // Add streaming assistant message
            streamEl = document.createElement('div');
            streamEl.className = 'chat-message assistant streaming';
            streamEl.style.cssText = 'margin-bottom:12px;display:flex;justify-content:flex-start;';
            container.appendChild(streamEl);
        }
        streamEl.innerHTML = `
      <div style="max-width:75%;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:11px;font-weight:600;color:var(--text-secondary);">AI</span>
          <span style="font-size:10px;color:var(--accent-blue);">生成中...</span>
        </div>
        <div class="chat-bubble-assistant">
          ${renderMessageContent(content)}
          <span class="streaming-cursor" style="display:inline-block;width:2px;height:14px;background:var(--accent-blue);margin-left:2px;vertical-align:middle;"></span>
        </div>
      </div>
    `;
        scrollToBottom();
    }
    function scrollToBottom() {
        const container = document.getElementById('chat-messages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }
    async function sendMessage() {
        if (activeSessionId && getStreamingState(activeSessionId).isStreaming)
            return;
        const input = document.getElementById('chat-input');
        const content = input?.value?.trim() || '';
        if (!content)
            return;
        if (!activeSessionId) {
            await createSession();
        }
        // Check for slash commands
        if (content.startsWith('/')) {
            await handleSlashCommand(content);
            input.value = '';
            autoResizeInput();
            return;
        }
        // Show user message immediately
        const container = document.getElementById('chat-messages');
        const emptyState = container?.querySelector('.empty-state') ?? null;
        if (emptyState)
            emptyState.remove();
        const userMsgHtml = `
      <div class="chat-message user" style="margin-bottom:12px;display:flex;justify-content:flex-end;">
        <div style="max-width:75%;order:2;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;justify-content:flex-end;">
            <span style="font-size:11px;font-weight:600;color:var(--text-secondary);">你</span>
            <span style="font-size:10px;color:var(--text-tertiary);">${formatTime(Date.now())}</span>
          </div>
          <div class="chat-bubble-user">
            ${renderMessageContent(content)}
          </div>
        </div>
      </div>
    `;
        container?.insertAdjacentHTML('beforeend', userMsgHtml);
        scrollToBottom();
        input.value = '';
        autoResizeInput();
        getStreamingState(activeSessionId).isStreaming = true;
        getStreamingState(activeSessionId).streamBuffer = '';
        updateSendButton();
        try {
            await API.post(`/chat/${activeSessionId}/messages`, { content });
        }
        catch (e) {
            getStreamingState(activeSessionId).isStreaming = false;
            updateSendButton();
            Toast.error('发送失败: ' + e.message);
            // Remove streaming indicator
            const streamingEl = container?.querySelector('.chat-message.streaming') ?? null;
            if (streamingEl)
                streamingEl.remove();
        }
    }
    async function handleSlashCommand(content) {
        const parts = content.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');
        if (!activeSessionId) {
            await createSession();
        }
        // /help — 显示所有可用命令
        if (cmd === '/help') {
            const lines = SLASH_COMMANDS.map((c) => `  ${c.cmd.padEnd(12)} ${c.desc}`);
            appendSystemMessage(`可用命令:\n${lines.join('\n')}\n\n提示: 输入 / 后可使用上下箭头选择命令`);
            return;
        }
        // /clear — 清空当前对话
        if (cmd === '/clear') {
            const confirmed = await Modal.confirm('清空对话', '确定清空当前对话的所有消息？');
            if (confirmed) {
                try {
                    await API.put(`/chat/${activeSessionId}`, { messages: [] });
                    await loadMessages(activeSessionId);
                    Toast.success('对话已清空');
                }
                catch (e) {
                    Toast.error('清空失败: ' + e.message);
                }
            }
            return;
        }
        // /compact — 压缩对话历史
        if (cmd === '/compact') {
            try {
                const summary = args || '之前的对话摘要';
                await API.post(`/chat/${activeSessionId}/messages`, {
                    content: `/compact ${summary}`
                });
                appendSystemMessage('对话历史已压缩，旧消息已被摘要替代。');
            }
            catch (e) {
                Toast.error('压缩失败: ' + e.message);
            }
            return;
        }
        // /model — 查看或切换模型
        if (cmd === '/model') {
            if (!args) {
                const currentModel = activeSessionMeta?.model || '默认';
                const globalModel = localStorage.getItem('chat.globalModel');
                appendSystemMessage(`当前会话模型: ${currentModel}${globalModel ? `\n全局默认模型: ${globalModel}` : ''}\n\n使用方法: /model <模型名>\n示例: /model deepseek-v4-pro\n\n切换后的模型将应用于当前会话，并设为全局默认（新会话自动使用）。`);
                return;
            }
            try {
                await API.put(`/chat/${activeSessionId}`, { model: args.trim() });
                if (activeSessionMeta)
                    activeSessionMeta.model = args.trim();
                localStorage.setItem('chat.globalModel', args.trim());
                updateModelInfo();
                appendSystemMessage(`模型已切换为: ${args.trim()}（已设为全局默认）`);
                Toast.success('模型已更新');
            }
            catch (e) {
                Toast.error('更新模型失败: ' + e.message);
            }
            return;
        }
        // /system — 查看或设置系统提示词
        if (cmd === '/system') {
            if (!args) {
                const currentPrompt = activeSessionMeta?.systemPrompt || '(未设置)';
                appendSystemMessage(`当前系统提示词:\n${currentPrompt}\n\n使用方法: /system <提示词>`);
                return;
            }
            try {
                await API.put(`/chat/${activeSessionId}`, { systemPrompt: args.trim() });
                if (activeSessionMeta)
                    activeSessionMeta.systemPrompt = args.trim();
                appendSystemMessage(`系统提示词已更新为:\n${args.trim()}`);
                Toast.success('系统提示词已更新');
            }
            catch (e) {
                Toast.error('更新系统提示词失败: ' + e.message);
            }
            return;
        }
        // /config — 查看或修改会话配置
        if (cmd === '/config') {
            if (!args) {
                const cfg = activeSessionMeta || {};
                appendSystemMessage(`当前配置:\n  模型: ${cfg.model || '默认'}\n  系统提示词: ${cfg.systemPrompt || '(未设置)'}\n  状态: ${cfg.status || 'active'}\n\n使用方法: /config <key> <value>\n可用配置项: model, systemPrompt`);
                return;
            }
            const cfgParts = args.split(/\s+/);
            const key = cfgParts[0];
            const value = cfgParts.slice(1).join(' ');
            if (!value) {
                const val = activeSessionMeta?.[key];
                appendSystemMessage(`${key}: ${val !== undefined ? val : '(未设置)'}`);
                return;
            }
            try {
                const updateData = {};
                updateData[key] = value;
                await API.put(`/chat/${activeSessionId}`, updateData);
                if (activeSessionMeta)
                    activeSessionMeta[key] = value;
                appendSystemMessage(`配置已更新: ${key} = ${value}`);
                Toast.success('配置已更新');
            }
            catch (e) {
                Toast.error('更新配置失败: ' + e.message);
            }
            return;
        }
        // /status — 显示会话状态
        if (cmd === '/status') {
            const session = activeSessionMeta || {};
            const streamStatus = (activeSessionId && getStreamingState(activeSessionId).isStreaming) ? '生成中' : '空闲';
            appendSystemMessage(`会话状态:\n  ID: ${activeSessionId || '(无)'}\n  标题: ${session.title || '未命名'}\n  模型: ${session.model || '默认'}\n  状态: ${session.status || 'active'}\n  流式状态: ${streamStatus}\n  消息数: ${(session.messages || []).length}`);
            return;
        }
        // /memory — 编辑系统提示词（CLAUDE.md 风格）
        if (cmd === '/memory') {
            if (!args) {
                const current = activeSessionMeta?.systemPrompt || '(未设置)';
                appendSystemMessage(`当前记忆/系统提示词:\n${current}\n\n使用方法: /memory <内容>\n这会设置系统提示词，AI 会在每次对话时参考这些内容。`);
                return;
            }
            try {
                await API.put(`/chat/${activeSessionId}`, { systemPrompt: args.trim() });
                if (activeSessionMeta)
                    activeSessionMeta.systemPrompt = args.trim();
                appendSystemMessage(`记忆已更新:\n${args.trim()}`);
                Toast.success('记忆已更新');
            }
            catch (e) {
                Toast.error('更新失败: ' + e.message);
            }
            return;
        }
        // /export — 导出对话
        if (cmd === '/export') {
            await exportSession();
            return;
        }
        // /archive — 归档对话
        if (cmd === '/archive') {
            await archiveCurrentSession();
            return;
        }
        // /delete — 删除对话
        if (cmd === '/delete') {
            const confirmed = await Modal.confirm('删除对话', '确定删除当前对话？此操作不可恢复。');
            if (confirmed) {
                try {
                    await API.del(`/chat/${activeSessionId}`);
                    Toast.success('对话已删除');
                    activeSessionId = null;
                    activeSessionMeta = null;
                    localStorage.removeItem(STORAGE_KEY);
                    await loadSessions();
                    const container = document.getElementById('chat-messages');
                    if (container) {
                        container.innerHTML = EmptyState.render({ icon: Icon.svg('chat', 40), title: '开始新对话', description: '与 AI 助手对话，获取编程知识、技术方案和问题解答' });
                    }
                }
                catch (e) {
                    Toast.error('删除失败: ' + e.message);
                }
            }
            return;
        }
        // /review — 请求 AI 审查代码
        if (cmd === '/review') {
            const prompt = args
                ? `请审查以下代码或文件并提供改进建议:\n${args}`
                : '请审查当前项目的代码质量，提供改进建议。';
            try {
                await API.post(`/chat/${activeSessionId}/messages`, { content: prompt });
            }
            catch (e) {
                Toast.error('发送失败: ' + e.message);
            }
            return;
        }
        // /bug — 报告问题
        if (cmd === '/bug') {
            const prompt = args
                ? `我遇到了一个问题:\n${args}\n\n请帮我分析原因并提供解决方案。`
                : '请描述你遇到的问题。';
            if (!args) {
                appendSystemMessage('请描述你遇到的问题。用法: /bug <问题描述>');
                return;
            }
            try {
                await API.post(`/chat/${activeSessionId}/messages`, { content: prompt });
            }
            catch (e) {
                Toast.error('发送失败: ' + e.message);
            }
            return;
        }
        // Unknown command
        appendSystemMessage(`未知命令: ${cmd}\n输入 /help 查看可用命令`);
    }
    function appendSystemMessage(content) {
        const container = document.getElementById('chat-messages');
        if (!container)
            return;
        const emptyState = container.querySelector('.empty-state');
        if (emptyState)
            emptyState.remove();
        container.insertAdjacentHTML('beforeend', `
      <div class="chat-message system" style="margin-bottom:12px;display:flex;justify-content:flex-start;">
        <div style="max-width:75%;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-size:11px;font-weight:600;color:var(--text-secondary);">系统</span>
          </div>
          <div class="chat-bubble-system">
            ${escapeHtml(content)}
          </div>
        </div>
      </div>
    `);
        scrollToBottom();
    }
    async function archiveCurrentSession() {
        if (!activeSessionId) {
            Toast.warning('没有活动对话');
            return;
        }
        try {
            await API.post(`/chat/${activeSessionId}/archive`);
            Toast.success('对话已归档');
            activeSessionId = null;
            localStorage.removeItem(STORAGE_KEY);
            await loadSessions();
            // Show empty state
            const container = document.getElementById('chat-messages');
            if (container) {
                container.innerHTML = EmptyState.render({ icon: Icon.svg('chat', 40), title: '开始新对话', description: '与 AI 助手对话，获取编程知识、技术方案和问题解答' });
            }
        }
        catch (e) {
            Toast.error('归档失败: ' + e.message);
        }
    }
    async function exportSession() {
        if (!activeSessionId)
            return;
        try {
            const res = await API.get(`/chat/${activeSessionId}`);
            const session = res.data;
            const lines = [`# ${session.title || '对话记录'}`, `导出时间: ${new Date().toLocaleString()}`, ''];
            (session.messages || []).forEach((msg) => {
                const role = msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : '系统';
                lines.push(`**${role}** (${formatTime(msg.timestamp || '')})`);
                lines.push(msg.content || '');
                lines.push('');
            });
            const text = lines.join('\n');
            // Copy to clipboard
            await navigator.clipboard.writeText(text);
            Toast.success('对话记录已复制到剪贴板');
        }
        catch (e) {
            Toast.error('导出失败: ' + e.message);
        }
    }
    return { render, cleanup, switchSession };
})();
