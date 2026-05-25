window.FormValidator = (() => {
  function validate(formId, rules) {
    let valid = true;
    const errors = {};

    for (const [fieldId, rule] of Object.entries(rules)) {
      const el = document.getElementById(fieldId);
      if (!el) continue;

      const value = el.value?.trim() || '';
      const group = el.closest('.form-group');
      const errorEl = group?.querySelector('.form-error');

      // Clear previous error state
      group?.classList.remove('error');
      if (errorEl) errorEl.textContent = '';

      // Validation
      if (rule.required && !value) {
        valid = false;
        errors[fieldId] = rule.message || '此字段为必填';
      } else if (rule.minLength && value.length < rule.minLength) {
        valid = false;
        errors[fieldId] = `最少 ${rule.minLength} 个字符`;
      } else if (rule.maxLength && value.length > rule.maxLength) {
        valid = false;
        errors[fieldId] = `最多 ${rule.maxLength} 个字符`;
      } else if (rule.pattern && !rule.pattern.test(value)) {
        valid = false;
        errors[fieldId] = rule.message || '格式不正确';
      }

      // Show error
      if (errors[fieldId]) {
        group?.classList.add('error');
        if (errorEl) {
          errorEl.textContent = errors[fieldId];
          errorEl.style.display = 'block';
        }
      }
    }

    return { valid, errors };
  }

  function clearErrors(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.querySelectorAll('.form-group').forEach(g => {
      g.classList.remove('error');
      const err = g.querySelector('.form-error');
      if (err) err.style.display = 'none';
    });
  }

  return { validate, clearErrors };
})();
