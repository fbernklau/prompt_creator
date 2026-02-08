function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

const PROMPT_ONLY_SYSTEM_INSTRUCTION = 'Du bist ein Prompt-Engineer. Gib ausschliesslich einen Handoff-Prompt aus und niemals die fachliche Endloesung.';

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timer };
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
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiLike({ baseUrl, model, apiKey, metaprompt, timeoutMs }) {
  const url = `${trimTrailingSlash(baseUrl)}/chat/completions`;
  const { response, payload } = await doJsonRequest({
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      messages: [
        { role: 'system', content: PROMPT_ONLY_SYSTEM_INSTRUCTION },
        { role: 'user', content: metaprompt },
      ],
      temperature: 0.2,
    },
    timeoutMs,
  });

  if (!response.ok) throw new Error(parseProviderError('openai', payload, response.status));
  const text = extractOpenAiLikeText(payload);
  if (!text) throw new Error('Provider lieferte keine Antwort.');
  return text;
}

async function callAnthropic({ baseUrl, model, apiKey, metaprompt, timeoutMs }) {
  const normalized = trimTrailingSlash(baseUrl);
  const url = normalized.endsWith('/v1')
    ? `${normalized}/messages`
    : `${normalized}/v1/messages`;

  const { response, payload } = await doJsonRequest({
    url,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model,
      max_tokens: 2048,
      system: PROMPT_ONLY_SYSTEM_INSTRUCTION,
      messages: [
        { role: 'user', content: metaprompt },
      ],
    },
    timeoutMs,
  });

  if (!response.ok) throw new Error(parseProviderError('anthropic', payload, response.status));
  const text = extractAnthropicText(payload);
  if (!text) throw new Error('Provider lieferte keine Antwort.');
  return text;
}

async function callGoogle({ baseUrl, model, apiKey, metaprompt, timeoutMs }) {
  const url = `${trimTrailingSlash(baseUrl)}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const { response, payload } = await doJsonRequest({
    url,
    body: {
      systemInstruction: {
        role: 'system',
        parts: [{ text: PROMPT_ONLY_SYSTEM_INSTRUCTION }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: metaprompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    },
    timeoutMs,
  });

  if (!response.ok) throw new Error(parseProviderError('google', payload, response.status));
  const text = extractGoogleText(payload);
  if (!text) throw new Error('Provider lieferte keine Antwort.');
  return text;
}

async function callProvider({ kind, baseUrl, model, apiKey, metaprompt, timeoutMs = 45000 }) {
  if (!kind) throw new Error('Provider kind fehlt.');
  if (!baseUrl) throw new Error('Provider base URL fehlt.');
  if (!model) throw new Error('Provider model fehlt.');
  if (!apiKey) throw new Error('Provider API key fehlt.');

  if (kind === 'openai' || kind === 'mistral') {
    return callOpenAiLike({ baseUrl, model, apiKey, metaprompt, timeoutMs });
  }
  if (kind === 'anthropic') {
    return callAnthropic({ baseUrl, model, apiKey, metaprompt, timeoutMs });
  }
  if (kind === 'google') {
    return callGoogle({ baseUrl, model, apiKey, metaprompt, timeoutMs });
  }

  throw new Error(`Provider '${kind}' wird aktuell nicht unterstuetzt.`);
}

module.exports = {
  callProvider,
};
