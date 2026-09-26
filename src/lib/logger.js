const SENSITIVE_KEYS = new Set(['password', 'passwordHash', 'accessToken', 'authorization', 'token']);

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEYS.has(key) ? '[REDACTED]' : redact(item),
  ]));
}

function write(level, message, fields = {}) {
  const entry = { level, time: new Date().toISOString(), message, ...redact(fields) };
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

export const logger = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
};

