"use strict";
// ═══════════════════════════════════════════════
// API Key Prompt — 检测未配置 API Key 时弹出提示
// ═══════════════════════════════════════════════
window.ApiKeyPrompt = (() => {
    const STORAGE_KEY = 'api_key_prompt_dismissed';
    let _checked = false;
    // 检查是否有已配置且启用的 API Key
    async function checkApiKeyConfigured() {
        try {
            const res = await API.getApiConfigs();
            const configs = Array.isArray(res.data) ? res.data : [];
            // 检查是否有任何一个配置了 API Key 且设为默认
            const hasDefault = configs.some(c => c.isDefault && c.hasKey);
            return hasDefault;
        }
        catch (e) {
            console.warn('[ApiKeyPrompt] 检查 API Key 配置失败:', e.message);
            return false;
        }
    }
    // 显示提示弹框
    function showPrompt() {
        // 检查是否已经关闭过（本次会话）
        if (sessionStorage.getItem(STORAGE_KEY) === 'true') {
            return;
        }
        Modal.open({
            title: 'API 密钥未配置',
            body: `
                <div style="text-align:center;padding:20px 0;">
                    <div style="font-size:48px;margin-bottom:16px;">🔑</div>
                    <h3 style="font-size:16px;font-weight:600;margin:0 0 12px;color:var(--text-primary);">
                        尚未配置 API 密钥
                    </h3>
                    <p style="font-size:13px;color:var(--text-secondary);margin:0 0 8px;line-height:1.6;">
                        主代理（Master Agent）需要配置 API 密钥才能正常工作。
                    </p>
                    <p style="font-size:12px;color:var(--text-muted);margin:0;line-height:1.6;">
                        子代理和其余功能使用 Claude Code CLI 的配置，无需额外设置。
                    </p>
                </div>
            `,
            footer: `
                <button class="btn btn-secondary" id="api-prompt-dismiss">稍后再说</button>
                <button class="btn btn-primary" id="api-prompt-goto-settings">前往配置</button>
            `,
        });
        // 绑定按钮事件
        setTimeout(() => {
            document.getElementById('api-prompt-dismiss')?.addEventListener('click', () => {
                sessionStorage.setItem(STORAGE_KEY, 'true');
                Modal.close();
            });
            document.getElementById('api-prompt-goto-settings')?.addEventListener('click', () => {
                Modal.close();
                Router.navigate('/settings');
                // 延迟切换到 API 密钥标签页
                setTimeout(() => {
                    const keysTab = document.querySelector('.settings-tab-btn[data-tab="keys"]');
                    if (keysTab) {
                        keysTab.click();
                    }
                }, 300);
            });
        }, 100);
    }
    // 初始化检查
    async function init() {
        if (_checked)
            return;
        _checked = true;
        const isConfigured = await checkApiKeyConfigured();
        if (!isConfigured) {
            showPrompt();
        }
    }
    return { init, checkApiKeyConfigured };
})();
