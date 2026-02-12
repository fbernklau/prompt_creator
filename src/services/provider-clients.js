function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

const PROMPT_ONLY_SYSTEM_INSTRUCTION = 'Du bist ein Prompt-Engineer. Gib ausschliesslich einen Handoff-Prompt aus und niemals die fachliche Endloesung.';
const MAX_PROVIDER_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timer };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ProviderHttpError extends Error {
  constructor(message, {
    status = 500,
    kind = '',
    overloaded = false,
    retryable = false,
    code = '',
  } = {}) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.kind = kind;
    this.overloaded = overloaded;
    this.retryable = retryable;
    this.code = code;
  }
}

async function parseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

function parseProviderError(kind, payload, status) {
  if (kind === 'google') {
    return payload?.error?.message || `Google API error (${status})`;
  }
  if (kind === 'anthropic') {
    return payload?.error?.message || `Anthropic API error (${status})`;
  }
  return payload?.error?.message || payload?.message || `${kind} API error (${status})`;
}

function extractOpenAiLikeText(payload) {
  return payload?.choices?.[0]?.message?.content || '';
}

function extractAnthropicText(payload) {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  return content
    .filter((entry) => entry?.type === 'text')
    .map((entry) => entry.text || '')
    .join('\n')
    .trim();
}

function extractGoogleText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part?.text || '').filter(Boolean).join('\n').trim();
}

function asNonNegativeInt(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) return 0;
  return Math.round(normalized);
}

function buildUsage({ promptTokens = 0, completionTokens = 0, totalTokens = 0 } = {}) {
  const input = asNonNegativeInt(promptTokens);
  const output = asNonNegativeInt(completionTokens);
  const providedTotal = asNonNegativeInt(totalTokens);
  return {
    promptTokens: input,
    completionTokens: output,
    totalTokens: providedTotal > 0 ? providedTotal : input + output,
  };
}

function extractOpenAiLikeUsage(payload = {}) {
  const usage = payload?.usage || {};
  return buildUsage({
    promptTokens: usage.prompt_tokens ?? usage.input_tokens,
    completionTokens: usage.completion_tokens ?? usage.output_tokens,
    totalTokens: usage.total_tokens,
  });
}

function extractAnthropicUsage(payload = {}) {
  const usage = payload?.usage || {};
  return buildUsage({
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  });
}

function extractGoogleUsage(payload = {}) {
  const usage = payload?.usageMetadata || {};
  return buildUsage({
    promptTokens: usage.promptTokenCount,
    completionTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
  });
}

function detectProviderErrorCode(payload = {}) {
  const rawStatus = payload?.error?.status || payload?.status || '';
  return String(rawStatus || '').trim().toUpperCase();
}

function isOverloadedError({ status, payload, message = '' }) {
  const code = detectProviderErrorCode(payload);
  const normalized = String(message || '').toLowerCase();
  if (status === 503 || status === 529) return true;
  if (status === 429 && normalized.includes('overload')) return true;
  if (code === 'UNAVAILABLE' || code === 'MODEL_OVERLOADED') return true;
  if (normalized.includes('model is overloaded')) return true;
  if (normalized.includes('overloaded')) return true;
  if (normalized.includes('temporarily unavailable')) return true;
  return false;
}

function isRetryableProviderError(error) {
  if (!error) return false;
  if (error.overloaded) return true;
  if (error.retryable) return true;
  if (error.status && RETRYABLE_STATUSES.has(Number(error.status))) return true;
  return false;
}

function isOverloadedProviderError(error) {
  return !!error?.overloaded;
}

async function doJsonRequest({ url, method = 'POST', headers = {}, body, timeoutMs = 45000 }) {
  const { controller, timer } = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await parseJson(response);
    return { response, payload };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ProviderHttpError('Provider request timeout.', {
        status: 408,
        kind: 'provider',
        retryable: true,
        code: 'TIMEOUT',
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function doStreamRequest({ url, method = 'POST', headers = {}, body, timeoutMs = 45000 }) {
  const { controller, timer } = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return { response };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ProviderHttpError('Provider request timeout.', {
        status: 408,
        kind: 'provider',
        retryable: true,
        code: 'TIMEOUT',
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readSseStream(response, onEvent) {
  if (!response?.body) {
    throw new Error('Streaming response body fehlt.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processChunk = (chunk, { flush = false } = {}) => {
    if (chunk) {
      buffer += chunk;
    }
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let boundaryIndex = buffer.indexOf('\n\n');
    while (boundaryIndex >= 0) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      boundaryIndex = buffer.indexOf('\n\n');

      const lines = rawEvent.split(/\r?\n/);
      let eventName = 'message';
      const dataLines = [];
      lines.forEach((line) => {
        if (!line) return;
        if (line.startsWith(':')) return;
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim() || 'message';
          return;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      });
      onEvent({
        event: eventName,
        data: dataLines.join('\n'),
      });
    }

    if (flush && buffer.trim()) {
      const lines = buffer.split(/\r?\n/);
      let eventName = 'message';
      const dataLines = [];
      lines.forEach((line) => {
        if (!line) return;
        if (line.startsWith(':')) return;
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim() || 'message';
          return;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      });
      buffer = '';
      onEvent({
        event: eventName,
        data: dataLines.join('\n'),
      });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    processChunk(decoder.decode(value, { stream: true }));
  }
  processChunk(decoder.decode(), { flush: true });
}

async function callOpenAiLike({
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  const url = `${trimTrailingSlash(baseUrl)}/chat/completions`;
  const messages = [];
  const normalizedSystemInstruction = String(systemInstruction || '').trim();
  if (normalizedSystemInstruction) {
    messages.push({ role: 'system', content: normalizedSystemInstruction });
  }
  messages.push({ role: 'user', content: metaprompt });
  const { response, payload } = await doJsonRequest({
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      messages,
      temperature: 0.2,
    },
    timeoutMs,
  });

  if (!response.ok) {
    const message = parseProviderError('openai', payload, response.status);
    throw new ProviderHttpError(message, {
      status: response.status,
      kind: 'openai',
      overloaded: isOverloadedError({ status: response.status, payload, message }),
      retryable: RETRYABLE_STATUSES.has(response.status),
      code: detectProviderErrorCode(payload),
    });
  }
  const text = extractOpenAiLikeText(payload);
  if (!text) throw new Error('Provider lieferte keine Antwort.');
  return {
    text,
    usage: extractOpenAiLikeUsage(payload),
  };
}

async function callOpenAiLikeStream({
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs,
  onTextDelta,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  const url = `${trimTrailingSlash(baseUrl)}/chat/completions`;
  const messages = [];
  const normalizedSystemInstruction = String(systemInstruction || '').trim();
  if (normalizedSystemInstruction) {
    messages.push({ role: 'system', content: normalizedSystemInstruction });
  }
  messages.push({ role: 'user', content: metaprompt });
  const { response } = await doStreamRequest({
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
    },
    body: {
      model,
      messages,
      temperature: 0.2,
      stream: true,
      stream_options: { include_usage: true },
    },
    timeoutMs,
  });

  if (!response.ok) {
    const payload = await parseJson(response);
    const message = parseProviderError('openai', payload, response.status);
    throw new ProviderHttpError(message, {
      status: response.status,
      kind: 'openai',
      overloaded: isOverloadedError({ status: response.status, payload, message }),
      retryable: RETRYABLE_STATUSES.has(response.status),
      code: detectProviderErrorCode(payload),
    });
  }

  let text = '';
  let usage = buildUsage();
  await readSseStream(response, ({ data }) => {
    if (!data || data === '[DONE]') return;
    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch (_error) {
      return;
    }
    const delta = payload?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      text += delta;
      if (typeof onTextDelta === 'function') onTextDelta(delta);
    }
    if (payload?.usage) {
      usage = extractOpenAiLikeUsage(payload);
    }
  });

  if (!text) throw new Error('Provider lieferte keine Antwort.');
  return { text, usage };
}

async function callAnthropic({
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  const normalized = trimTrailingSlash(baseUrl);
  const url = normalized.endsWith('/v1')
    ? `${normalized}/messages`
    : `${normalized}/v1/messages`;

  const normalizedSystemInstruction = String(systemInstruction || '').trim();
  const body = {
    model,
    max_tokens: 2048,
    messages: [
      { role: 'user', content: metaprompt },
    ],
  };
  if (normalizedSystemInstruction) {
    body.system = normalizedSystemInstruction;
  }

  const { response, payload } = await doJsonRequest({
    url,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
    timeoutMs,
  });

  if (!response.ok) {
    const message = parseProviderError('anthropic', payload, response.status);
    throw new ProviderHttpError(message, {
      status: response.status,
      kind: 'anthropic',
      overloaded: isOverloadedError({ status: response.status, payload, message }),
      retryable: RETRYABLE_STATUSES.has(response.status),
      code: detectProviderErrorCode(payload),
    });
  }
  const text = extractAnthropicText(payload);
  if (!text) throw new Error('Provider lieferte keine Antwort.');
  return {
    text,
    usage: extractAnthropicUsage(payload),
  };
}

async function callAnthropicStream({
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs,
  onTextDelta,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  const normalized = trimTrailingSlash(baseUrl);
  const url = normalized.endsWith('/v1')
    ? `${normalized}/messages`
    : `${normalized}/v1/messages`;

  const normalizedSystemInstruction = String(systemInstruction || '').trim();
  const body = {
    model,
    max_tokens: 2048,
    messages: [
      { role: 'user', content: metaprompt },
    ],
    stream: true,
  };
  if (normalizedSystemInstruction) {
    body.system = normalizedSystemInstruction;
  }

  const { response } = await doStreamRequest({
    url,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      Accept: 'text/event-stream',
    },
    body,
    timeoutMs,
  });

  if (!response.ok) {
    const payload = await parseJson(response);
    const message = parseProviderError('anthropic', payload, response.status);
    throw new ProviderHttpError(message, {
      status: response.status,
      kind: 'anthropic',
      overloaded: isOverloadedError({ status: response.status, payload, message }),
      retryable: RETRYABLE_STATUSES.has(response.status),
      code: detectProviderErrorCode(payload),
    });
  }

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  await readSseStream(response, ({ data }) => {
    if (!data) return;
    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch (_error) {
      return;
    }

    const delta = payload?.delta?.text;
    if (typeof delta === 'string' && delta) {
      text += delta;
      if (typeof onTextDelta === 'function') onTextDelta(delta);
    }

    const messageUsage = payload?.message?.usage || {};
    const eventUsage = payload?.usage || {};
    if (Number.isFinite(Number(messageUsage.input_tokens))) {
      inputTokens = asNonNegativeInt(messageUsage.input_tokens);
    }
    if (Number.isFinite(Number(eventUsage.input_tokens))) {
      inputTokens = asNonNegativeInt(eventUsage.input_tokens);
    }
    if (Number.isFinite(Number(messageUsage.output_tokens))) {
      outputTokens = asNonNegativeInt(messageUsage.output_tokens);
    }
    if (Number.isFinite(Number(eventUsage.output_tokens))) {
      outputTokens = asNonNegativeInt(eventUsage.output_tokens);
    }
  });

  if (!text) throw new Error('Provider lieferte keine Antwort.');
  return {
    text,
    usage: buildUsage({
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    }),
  };
}

async function callGoogle({
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  const url = `${trimTrailingSlash(baseUrl)}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const normalizedSystemInstruction = String(systemInstruction || '').trim();
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: metaprompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };
  if (normalizedSystemInstruction) {
    body.systemInstruction = {
      role: 'system',
      parts: [{ text: normalizedSystemInstruction }],
    };
  }
  const { response, payload } = await doJsonRequest({
    url,
    body,
    timeoutMs,
  });

  if (!response.ok) {
    const message = parseProviderError('google', payload, response.status);
    throw new ProviderHttpError(message, {
      status: response.status,
      kind: 'google',
      overloaded: isOverloadedError({ status: response.status, payload, message }),
      retryable: RETRYABLE_STATUSES.has(response.status),
      code: detectProviderErrorCode(payload),
    });
  }
  const text = extractGoogleText(payload);
  if (!text) throw new Error('Provider lieferte keine Antwort.');
  return {
    text,
    usage: extractGoogleUsage(payload),
  };
}

async function callGoogleStream({
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs,
  onTextDelta,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  const url = `${trimTrailingSlash(baseUrl)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const normalizedSystemInstruction = String(systemInstruction || '').trim();
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: metaprompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };
  if (normalizedSystemInstruction) {
    body.systemInstruction = {
      role: 'system',
      parts: [{ text: normalizedSystemInstruction }],
    };
  }
  const { response } = await doStreamRequest({
    url,
    headers: {
      Accept: 'text/event-stream',
    },
    body,
    timeoutMs,
  });

  if (!response.ok) {
    const payload = await parseJson(response);
    const message = parseProviderError('google', payload, response.status);
    throw new ProviderHttpError(message, {
      status: response.status,
      kind: 'google',
      overloaded: isOverloadedError({ status: response.status, payload, message }),
      retryable: RETRYABLE_STATUSES.has(response.status),
      code: detectProviderErrorCode(payload),
    });
  }

  let text = '';
  let usage = buildUsage();

  await readSseStream(response, ({ data }) => {
    if (!data) return;
    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch (_error) {
      return;
    }

    const nextText = extractGoogleText(payload);
    if (nextText) {
      let delta = nextText;
      if (text && nextText.startsWith(text)) {
        delta = nextText.slice(text.length);
      } else if (text.endsWith(nextText)) {
        delta = '';
      }
      if (delta) {
        text += delta;
        if (typeof onTextDelta === 'function') onTextDelta(delta);
      } else if (nextText.length > text.length) {
        text = nextText;
      }
    }

    const nextUsage = extractGoogleUsage(payload);
    if (nextUsage.totalTokens > 0 || nextUsage.promptTokens > 0 || nextUsage.completionTokens > 0) {
      usage = nextUsage;
    }
  });

  if (!text) throw new Error('Provider lieferte keine Antwort.');
  return { text, usage };
}

async function callProviderOnce({
  kind,
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs = 45000,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  if (kind === 'openai' || kind === 'mistral') {
    return callOpenAiLike({ baseUrl, model, apiKey, metaprompt, timeoutMs, systemInstruction });
  }
  if (kind === 'anthropic') {
    return callAnthropic({ baseUrl, model, apiKey, metaprompt, timeoutMs, systemInstruction });
  }
  if (kind === 'google') {
    return callGoogle({ baseUrl, model, apiKey, metaprompt, timeoutMs, systemInstruction });
  }
  throw new Error(`Provider '${kind}' wird aktuell nicht unterstuetzt.`);
}

async function callProviderOnceStream({
  kind,
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs = 45000,
  onTextDelta,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  if (kind === 'openai' || kind === 'mistral') {
    return callOpenAiLikeStream({ baseUrl, model, apiKey, metaprompt, timeoutMs, onTextDelta, systemInstruction });
  }
  if (kind === 'anthropic') {
    return callAnthropicStream({ baseUrl, model, apiKey, metaprompt, timeoutMs, onTextDelta, systemInstruction });
  }
  if (kind === 'google') {
    return callGoogleStream({ baseUrl, model, apiKey, metaprompt, timeoutMs, onTextDelta, systemInstruction });
  }
  const fallback = await callProviderOnce({ kind, baseUrl, model, apiKey, metaprompt, timeoutMs, systemInstruction });
  if (fallback?.text && typeof onTextDelta === 'function') {
    onTextDelta(fallback.text);
  }
  return fallback;
}

async function callProvider({
  kind,
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs = 45000,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  const result = await callProviderDetailed({ kind, baseUrl, model, apiKey, metaprompt, timeoutMs, systemInstruction });
  return result.text;
}

async function callProviderDetailed({
  kind,
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs = 45000,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  if (!kind) throw new Error('Provider kind fehlt.');
  if (!baseUrl) throw new Error('Provider base URL fehlt.');
  if (!model) throw new Error('Provider model fehlt.');
  if (!apiKey) throw new Error('Provider API key fehlt.');

  let attempt = 0;
  let lastError = null;
  while (attempt < MAX_PROVIDER_ATTEMPTS) {
    attempt += 1;
    try {
      return await callProviderOnce({ kind, baseUrl, model, apiKey, metaprompt, timeoutMs, systemInstruction });
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderError(error) || attempt >= MAX_PROVIDER_ATTEMPTS) break;
      const backoffMs = 500 * Math.pow(2, attempt - 1);
      await wait(backoffMs);
    }
  }
  throw lastError || new Error(`Provider '${kind}' wird aktuell nicht unterstuetzt.`);
}

async function callProviderDetailedStream({
  kind,
  baseUrl,
  model,
  apiKey,
  metaprompt,
  timeoutMs = 45000,
  onTextDelta,
  systemInstruction = PROMPT_ONLY_SYSTEM_INSTRUCTION,
}) {
  if (!kind) throw new Error('Provider kind fehlt.');
  if (!baseUrl) throw new Error('Provider base URL fehlt.');
  if (!model) throw new Error('Provider model fehlt.');
  if (!apiKey) throw new Error('Provider API key fehlt.');

  let attempt = 0;
  let lastError = null;
  while (attempt < MAX_PROVIDER_ATTEMPTS) {
    attempt += 1;
    let emittedDelta = false;
    try {
      return await callProviderOnceStream({
        kind,
        baseUrl,
        model,
        apiKey,
        metaprompt,
        timeoutMs,
        systemInstruction,
        onTextDelta: (delta) => {
          if (!delta) return;
          emittedDelta = true;
          if (typeof onTextDelta === 'function') onTextDelta(delta);
        },
      });
    } catch (error) {
      lastError = error;
      if (emittedDelta || !isRetryableProviderError(error) || attempt >= MAX_PROVIDER_ATTEMPTS) break;
      const backoffMs = 500 * Math.pow(2, attempt - 1);
      await wait(backoffMs);
    }
  }

  throw lastError || new Error(`Provider '${kind}' wird aktuell nicht unterstuetzt.`);
}

module.exports = {
  callProvider,
  callProviderDetailed,
  callProviderDetailedStream,
  isOverloadedProviderError,
};
