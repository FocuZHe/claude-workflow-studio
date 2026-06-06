"use strict";
// Self-repair utilities shared by WorkflowService and TaskService.
// Adaptive retry delay, model fallback chain, input truncation.
Object.defineProperty(exports, "__esModule", { value: true });
const SELF_REPAIR_MAX = 3; // Extra repair attempts beyond user-configured retries
/**
 * Calculate adaptive retry delay based on error type and attempt number.
 */
function getAdaptiveDelay(lastError, attempt, baseDelay = 1000) {
    const errorType = lastError?.errorType;
    switch (errorType) {
        case 'RATE_LIMITED':
            return Math.min(5000 * Math.pow(3, attempt - 1), 60000);
        case 'TOKEN_EXHAUSTED':
            return Math.min(30000 * Math.pow(2, attempt - 1), 120000);
        case 'SERVICE_OVERLOADED':
            return Math.min(10000 * Math.pow(3, attempt - 1), 120000);
        default:
            return Math.min(baseDelay * Math.pow(2, attempt - 1), 30000);
    }
}
/**
 * Get a human-readable hint for the self-repair action.
 */
function getSelfRepairHint(error) {
    const hints = {
        'TOKEN_EXHAUSTED': 'Token 额度不足，等待后重试并尝试备用模型',
        'RATE_LIMITED': '请求频率超限，指数退避等待中',
        'SERVICE_OVERLOADED': 'API 服务过载，等待后重试',
        'CONTEXT_TOO_LONG': '上下文超长，尝试缩短输入',
        'AUTH_ERROR': '认证失败，需要修复 API Key',
        'BILLING_ERROR': '账户余额不足，需要充值',
        'EXECUTION_ERROR': '执行错误，重试中'
    };
    return hints[error?.errorType] || '重试中';
}
/**
 * Truncate input to fit within context limits.
 */
function truncateInput(input, ratio = 0.7) {
    if (!input || typeof input !== 'string')
        return input;
    const targetLen = Math.floor(input.length * ratio);
    if (input.length <= targetLen)
        return input;
    const keepStart = Math.floor(targetLen * 0.6);
    const keepEnd = Math.floor(targetLen * 0.4);
    return input.substring(0, keepStart) +
        '\n\n... [内容已自动缩短以适配上下文窗口] ...\n\n' +
        input.substring(input.length - keepEnd);
}
/**
 * Get a fallback model for the current model.
 */
function getFallbackModel(currentModel) {
    const fallbackChain = {
        'opus': 'sonnet',
        'sonnet': 'haiku',
        'haiku': 'sonnet',
        // Legacy Anthropic IDs → aliases
        'claude-opus-4-7': 'sonnet',
        'claude-opus-4-6': 'sonnet',
        'claude-opus-4-20250514': 'sonnet',
        'claude-sonnet-4-6': 'haiku',
        'claude-sonnet-4-5': 'haiku',
        'claude-sonnet-4-20250514': 'haiku',
        'claude-haiku-4-5-20251001': 'haiku',
        'glm-5.1': 'sonnet',
        'deepseek-v4-pro': 'sonnet',
        'deepseek-v4-flash': 'haiku'
    };
    return fallbackChain[currentModel] || 'haiku';
}
/**
 * Determine if an error is non-retryable (should fail immediately).
 */
function isNonRetryable(error) {
    if (error?.errorType === 'AUTH_ERROR' ||
        error?.errorType === 'BILLING_ERROR' ||
        error?.errorType === 'CLI_NOT_FOUND' ||
        error?.errorType === 'CIRCUIT_OPEN') {
        return true;
    }
    if (error?.retryable === false) {
        return true;
    }
    return false;
}
/**
 * Check if the same error has occurred repeatedly (same errorType + similar message).
 */
const CONSECUTIVE_SAME_ERROR_MAX = 3;
function isRepeatedFailure(previousError, currentError) {
    if (!previousError || !currentError)
        return false;
    return previousError.errorType === currentError.errorType &&
        previousError.message === currentError.message;
}
/**
 * Determine if retries should stop because the same error keeps recurring.
 */
function shouldStopRetry(lastError, sameErrorCount) {
    if (sameErrorCount >= CONSECUTIVE_SAME_ERROR_MAX)
        return true;
    if (lastError?.errorType === 'EXECUTION_ERROR' && sameErrorCount >= 2)
        return true;
    return false;
}
module.exports = {
    SELF_REPAIR_MAX,
    CONSECUTIVE_SAME_ERROR_MAX,
    getAdaptiveDelay,
    getSelfRepairHint,
    truncateInput,
    getFallbackModel,
    isNonRetryable,
    isRepeatedFailure,
    shouldStopRetry
};
//# sourceMappingURL=SelfRepair.js.map