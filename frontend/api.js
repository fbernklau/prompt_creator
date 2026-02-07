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
    throw new Error(details);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export { api };
