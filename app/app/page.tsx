'use client';

import { useCallback, useEffect, useState } from 'react';
import Countdown from './components/Countdown';
import config from '../../template.config.json';

interface GrantedCode {
  code: string;
  expiresAt: number;
  status: 'active' | 'expired' | 'revoked';
  timeoutMinutes: number;
}

interface MyRequest {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
  grantedCode: GrantedCode | null;
}

export default function Home() {
  const [name, setName] = useState('');
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedWin, setCopiedWin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/requests');
    if (res.ok) setRequests((await res.json()).requests);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    setName('');
    setSubmitting(false);
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/requests/${id}`, { method: 'DELETE' });
    load();
  }

  const installCmd = `curl -fsSL ${config.vercelUrl.replace(/\/+$/, '')}/install.sh | bash`;
  const winInstallCmd = `irm ${config.vercelUrl.replace(/\/+$/, '')}/install.ps1 | iex`;

  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>{config.brandName}</h1>

      <section>
        <h2>Request access</h2>
        <form onSubmit={submit}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={100}
            required
          />{' '}
          <button type="submit" disabled={submitting}>Request code</button>
        </form>
      </section>

      <section>
        <h2>Install</h2>
        <p>
          macOS / Linux:{' '}
          <code>{installCmd}</code>{' '}
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(installCmd);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </p>
        <p>
          Windows (PowerShell):{' '}
          <code>{winInstallCmd}</code>{' '}
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(winInstallCmd);
              setCopiedWin(true);
              setTimeout(() => setCopiedWin(false), 2000);
            }}
          >
            {copiedWin ? 'Copied' : 'Copy'}
          </button>
        </p>
      </section>

      <section>
        <h2>My requests</h2>
        {requests.length === 0 ? (
          <p>No requests yet.</p>
        ) : (
          <ul>
            {requests.map((r) => (
              <li key={r.id} style={{ marginBottom: '0.5rem' }}>
                <strong>{r.name}</strong>
                {' — '}
                {r.grantedCode ? r.grantedCode.status : r.status}
                {r.grantedCode?.status === 'active' && (
                  <>
                    {' — code: '}
                    <code>{r.grantedCode.code}</code>
                    {' — expires in '}
                    <Countdown expiresAt={r.grantedCode.expiresAt} onExpire={load} />
                  </>
                )}{' '}
                <button onClick={() => remove(r.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
