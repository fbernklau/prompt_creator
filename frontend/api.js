async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    let details = 'Request failed';
    try {
      const payload = await response.json();
      details = payload.error || details;
    } catch (_error) {
      // ignore json parse errors
    }
    const error = new Error(details);
    error.status = response.status;
    throw error;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function apiStream(url, options = {}) {
  const {
    onEvent = () => {},
    ...fetchOptions
  } = options || {};
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) },
    ...fetchOptions,
  });

  if (!response.ok) {
    let details = 'Request failed';
    try {
      const payload = await response.json();
      details = payload.error || details;
    } catch (_error) {
      try {
        const text = await response.text();
        if (text) details = text;
      } catch (_textError) {
        // ignore
      }
    }
    throw new Error(details);
  }

  const emitLine = (line) => {
    const normalized = String(line || '').trim();
    if (!normalized) return;
    let payload = null;
    try {
      payload = JSON.parse(normalized);
    } catch (_error) {
      return;
    }
    onEvent(payload);
  };

  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    String(text || '')
      .split(/\r?\n/)
      .forEach((line) => emitLine(line));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundaryIndex = buffer.indexOf('\n');
    while (boundaryIndex >= 0) {
      const line = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 1);
      emitLine(line);
      boundaryIndex = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) emitLine(buffer);
}

export { api, apiStream };
