import { useEffect, useState } from 'react';
import { LockKeyhole, MapPin } from 'lucide-react';

export default function AuthGate({ children }) {
  const [status, setStatus] = useState(import.meta.env.DEV ? 'authenticated' : 'checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (import.meta.env.DEV) return;
    fetch('/api/auth/status', { credentials: 'same-origin' })
      .then((response) => setStatus(response.ok ? 'authenticated' : 'anonymous'))
      .catch(() => setStatus('anonymous'));
  }, []);

  const login = async (event) => {
    event.preventDefault();
    setStatus('checking');
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '로그인에 실패했습니다.');
      setPassword('');
      setStatus('authenticated');
    } catch (loginError) {
      setError(loginError.message);
      setStatus('anonymous');
    }
  };

  if (status === 'authenticated') return children;
  return <main className="private-login"><section><div className="private-brand"><span><MapPin size={27}/></span><div><strong>로컬픽</strong><small>LOCAL PICK</small></div></div><div className="private-lock"><LockKeyhole size={25}/></div><h1>비공개 로컬픽</h1><p>본인만 사용할 수 있도록 보호된 지도입니다.</p>{status === 'checking' ? <div className="private-checking"><span/>접속 권한 확인 중…</div> : <form onSubmit={login}><label htmlFor="private-password">접속 비밀번호</label><input id="private-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus required placeholder="힌트: 내 유튜브 닉네임"/>{error && <p className="private-error">{error}</p>}<button type="submit">로컬픽 열기</button></form>}<small className="private-notice">비밀번호는 서버에서만 확인되며 브라우저에 저장되지 않습니다.</small></section></main>;
}

