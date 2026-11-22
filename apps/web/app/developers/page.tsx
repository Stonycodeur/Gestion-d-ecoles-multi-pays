'use client';
import { useEffect, useState } from 'react';
import { API_BASE } from '../../lib/api';

/** Public developer portal: no login, content comes from the API itself so it cannot drift. */
export default function DevelopersPage() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { fetch(`${API_BASE}/public-api/docs`).then((r) => r.json()).then(setD).catch(() => setErr('Documentation indisponible')); }, []);
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: 16 }}>
      <h1>Portail développeur — ÉcoleManager Pro</h1>
      {err && <p role="alert">{err}</p>}
      {d && <>
        <h2>Authentification</h2><p>{d.authentication.type} — POST <code>{d.authentication.token_url}</code></p>
        <pre>{JSON.stringify(d.authentication.body, null, 2)}</pre><p>Jeton valable {d.authentication.token_ttl_seconds} s. {d.authentication.usage}</p>
        <h2>Portées</h2><ul>{d.scopes.map((s: string) => <li key={s}><code>{s}</code></li>)}</ul>
        <h2>REST</h2><ul>{d.rest.map((e: any) => <li key={e.path}><code>{e.method} {e.path}</code> {e.scope ? `(portée ${e.scope})` : ''}</li>)}</ul>
        <h2>GraphQL</h2><p><code>{d.graphql.method} {d.graphql.path}</code></p><pre>{d.graphql.schema}</pre>
        <h2>Quotas</h2><p>{d.quotas}</p>
        <h2>Webhooks signés</h2><p>Événements : {d.webhooks.events.join(', ')}. En-têtes : {d.webhooks.headers.join(', ')}.</p><p>Signature : <code>{d.webhooks.signature}</code></p>
        <h2>Données</h2><p>{d.data_minimisation}</p>
        <p><a href={`${API_BASE}/docs`}>Référence OpenAPI (Swagger)</a></p></>}
    </main>
  );
}
