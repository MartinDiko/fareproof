import { useState, type FormEvent } from 'react';
import { LockKeyhole, Plane } from 'lucide-react';

interface LoginProps {
  onUnlock: (password: string) => Promise<void>;
}

export function Login({ onUnlock }: LoginProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(false);
    setLoading(true);
    try {
      await onUnlock(password);
    } catch {
      setError(true);
      setLoading(false);
    }
  };

  return <main className="login-shell"><form className="login-panel" onSubmit={(event) => void submit(event)}><div className="login-brand"><div className="logo-mark"><Plane size={22} /></div><div><h1>FareProof</h1><p>Private fare verification</p></div></div><div className="login-heading"><LockKeyhole size={18} /><h2>Unlock dashboard</h2></div><p className="login-copy">Enter the FareProof password to continue.</p><label className="login-field">Password<input autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary" type="submit" disabled={loading || !password}>{loading ? 'Unlocking…' : 'Unlock'}</button>{error && <p className="login-error" role="alert">Incorrect password. Try again.</p>}</form></main>;
}