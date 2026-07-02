'use client';

import { useCallback, useEffect, useState } from 'react';
import Countdown from '../components/Countdown';

interface AdminRequest {
  id: string;
  name: string;
  cookieId: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
}

interface AdminCode {
  code: string;
  requestId: string;
  name: string;
  timeoutMinutes: number;
  approvedAt: number;
  expiresAt: number;
  status: 'active' | 'expired' | 'revoked';
}

async function post(url: string, body: unknown) {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function PendingRow({ req, onDone }: { req: AdminRequest; onDone: () => void }) {
  const [minutes, setMinutes] = useState(60);
  return (
    <tr>
      <td>{req.name}</td>
      <td>{new Date(req.createdAt).toLocaleString()}</td>
      <td>
        <input
          type="number"
          min={1}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          style={{ width: '5em' }}
        />{' '}
        min{' '}
        <button
          onClick={async () => {
            await post('/api/admin/approve', { requestId: req.id, timeoutMinutes: minutes });
            onDone();
          }}
        >
          Approve
        </button>{' '}
        <button
          onClick={async () => {
            await post('/api/admin/deny', { requestId: req.id });
            onDone();
          }}
        >
          Deny
        </button>
      </td>
    </tr>
  );
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<{ requests: AdminRequest[]; codes: AdminCode[] } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/state');
    if (res.status === 401) {
      setNeedsLogin(true);
      setState(null);
      return;
    }
    if (res.ok) {
      setNeedsLogin(false);
      setState(await res.json());
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setPassword('');
      setError('');
      load();
    } else {
      setError('Wrong password');
    }
  }

  async function del(url: string) {
    await fetch(url, { method: 'DELETE' });
    load();
  }

  const wrap = { maxWidth: 800, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' } as const;

  if (needsLogin) {
    return (
      <main style={wrap}>
        <h1>Admin login</h1>
        <form onSubmit={login}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
          />{' '}
          <button type="submit">Log in</button>
        </form>
        {error && <p>{error}</p>}
      </main>
    );
  }

  if (!state) return <main style={wrap}>Loading…</main>;

  const pending = state.requests.filter((r) => r.status === 'pending');
  const deniedRequests = state.requests.filter((r) => r.status === 'denied');
  const activeCodes = state.codes.filter((c) => c.status === 'active');
  const pastCodes = state.codes.filter((c) => c.status !== 'active');

  return (
    <main style={wrap}>
      <h1>Admin</h1>

      <section>
        <h2>Pending requests</h2>
        {pending.length === 0 ? (
          <p>None.</p>
        ) : (
          <table border={1} cellPadding={6}>
            <thead>
              <tr><th>Name</th><th>Requested</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <PendingRow key={r.id} req={r} onDone={load} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Active codes</h2>
        {activeCodes.length === 0 ? (
          <p>None.</p>
        ) : (
          <table border={1} cellPadding={6}>
            <thead>
              <tr><th>Name</th><th>Code</th><th>Expires in</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {activeCodes.map((c) => (
                <tr key={c.code}>
                  <td>{c.name}</td>
                  <td><code>{c.code}</code></td>
                  <td><Countdown expiresAt={c.expiresAt} onExpire={load} /></td>
                  <td>
                    <button
                      onClick={async () => {
                        await post('/api/admin/revoke', { code: c.code });
                        load();
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Past codes</h2>
        {pastCodes.length === 0 ? (
          <p>None.</p>
        ) : (
          <table border={1} cellPadding={6}>
            <thead>
              <tr><th>Name</th><th>Code</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {pastCodes.map((c) => (
                <tr key={c.code}>
                  <td>{c.name}</td>
                  <td><code>{c.code}</code></td>
                  <td>{c.status}</td>
                  <td>
                    <button onClick={() => del(`/api/admin/codes/${c.code}`)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Denied requests</h2>
        {deniedRequests.length === 0 ? (
          <p>None.</p>
        ) : (
          <table border={1} cellPadding={6}>
            <thead>
              <tr><th>Name</th><th>Requested</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {deniedRequests.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>
                    <button onClick={() => del(`/api/admin/requests/${r.id}`)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
