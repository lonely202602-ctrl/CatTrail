/** 登录/注册页：玻璃卡片居中 + 品牌氛围背景（光斑 + 爪印水印） */
import { useState } from 'react';
import { loginUser, registerUser } from '../data/adapter';

/** 非地图页共用的氛围背景：柔和光斑 + 爪印水印（纯装饰） */
export function PageDecor() {
  return (
    <div className="pagedecor" aria-hidden>
      <i className="pagedecor__blob b1" />
      <i className="pagedecor__blob b2" />
      <i className="pagedecor__blob b3" />
      <svg className="pagedecor__paw" viewBox="0 0 64 64" width="420" height="420">
        <g fill="currentColor">
          <ellipse cx="32" cy="42" rx="13" ry="11" />
          <ellipse cx="16" cy="24" rx="6.5" ry="7.5" transform="rotate(-14 16 24)" />
          <ellipse cx="32" cy="17" rx="6.5" ry="7.5" />
          <ellipse cx="48" cy="24" rx="6.5" ry="7.5" transform="rotate(14 48 24)" />
        </g>
      </svg>
    </div>
  );
}

export function AuthPage({ theme, onAuthed }: { theme: 'night' | 'day'; onAuthed: (username: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r =
        mode === 'login'
          ? await loginUser(username.trim(), password)
          : await registerUser(username.trim(), password);
      onAuthed(r.username);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`authpage authpage-${theme}`}>
      <PageDecor />
      <div className="authcard">
        <img className="authcard__logo" src="/brand/logo-icon.png?v=3" alt="" />
        <h1 className="authcard__brand">
          猫踪<span>CAT TRAIL</span>
        </h1>
        <p className="authcard__slogan">你的每一次骑行，都是这座城市里猫的踪迹</p>

        <div className="authcard__tabs" role="tablist">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')} role="tab" aria-selected={mode === 'login'}>
            登录
          </button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')} role="tab" aria-selected={mode === 'register'}>
            注册
          </button>
        </div>

        <label className="field">
          <span>用户名</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="2-32 个字符"
            autoComplete="username"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <label className="field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? '至少 6 位' : '输入密码'}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>

        {err && <div className="authcard__err">{err}</div>}

        <button className="authcard__submit" disabled={busy || !username.trim() || !password.trim()} onClick={submit}>
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入'}
        </button>

        <p className="authcard__note">
          {mode === 'register'
            ? '首个注册的账号会认领服务器里已有的历史骑行数据'
            : '数据按账号隔离，只有你能看到自己的骑行'}
        </p>
      </div>
    </div>
  );
}
