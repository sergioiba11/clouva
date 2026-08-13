import { useEffect, useState } from 'react';
import { fetchRealTemplates, fitRealTemplate } from './templateLibraryClient';

export default function TemplateRealGarmentPanel({ token, runId, onFitted }) {
  const [templates, setTemplates] = useState([]);
  const [templateCode, setTemplateCode] = useState('r1');
  const [fitMode, setFitMode] = useState('oversized');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchRealTemplates(token)
      .then((data) => {
        if (!cancelled) setTemplates(data.templates || []);
      })
      .catch((err) => !cancelled && setError(String(err)));
    return () => { cancelled = true; };
  }, [token]);

  async function handleFit() {
    setLoading(true);
    setError('');
    try {
      const payload = await fitRealTemplate({ runId, templateCode, fitMode, token });
      onFitted?.(payload);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="template-real-panel">
      <h3>Plantilla real CLOUVA</h3>
      <select value={templateCode} onChange={(e) => setTemplateCode(e.target.value)}>
        {templates.map((item) => (
          <option key={item.code} value={item.code}>{item.name}</option>
        ))}
      </select>
      <select value={fitMode} onChange={(e) => setFitMode(e.target.value)}>
        <option value="base">Base</option>
        <option value="regular">Regular</option>
        <option value="oversized">Oversized</option>
      </select>
      <button disabled={!runId || loading} onClick={handleFit}>
        {loading ? 'Ajustando…' : 'Ajustar al avatar'}
      </button>
      {error ? <p>{error}</p> : null}
    </div>
  );
}
