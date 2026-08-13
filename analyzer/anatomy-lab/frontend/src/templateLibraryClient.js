export async function fetchRealTemplates(token) {
  const res = await fetch('/api/templates', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fitRealTemplate({ runId, templateCode, fitMode = 'oversized', token }) {
  const form = new FormData();
  form.append('template_code', templateCode);
  form.append('fit_mode', fitMode);
  const res = await fetch(`/api/runs/${runId}/fit-template`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
