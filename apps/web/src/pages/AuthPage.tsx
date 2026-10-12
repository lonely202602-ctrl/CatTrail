/** 登录/注册页：品牌化左右分栏（展示区 + 表单区），氛围背景 */
import { useState } from 'react';
import { loginUser, registerUser } from '../data/adapter';

/** 非地图页共用的氛围背景：柔和光斑（纯装饰） */
export function PageDecor() {
  return (
    <div className="pagedecor" aria-hidden>
      <i className="pagedecor__blob b1" />
      <i className="pagedecor__blob b2" />
      <i className="pagedecor__blob b3" />
    </div>
  );
}

/** 品牌展示区里的流动骑行路线（虚线偏移动画 + 爪印节点） */
function RouteArt() {
  return (
    <svg className="authshow__route" viewBox="0 0 380 130" aria-hidden>
      <path
        className="authshow__path"
        d="M14 104 C 70 18, 132 116, 196 58 S 300 22, 366 46"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="7 9"
      />
      <circle cx="14" cy="104" r="5" fill="var(--cat-orange)" stroke="var(--bg-0)" strokeWidth="2" />
      {[
        [92, 52],
        [178, 78],
        [268, 34],
      ].map(([x, y]) => (
        <g key={`${x}`} transform={`translate(${x} ${y}) scale(0.34)`} fill="currentColor" opacity="0.85">
          <ellipse cx="0" cy="6" rx="13" ry="11" />
          <ellipse cx="-16" cy="-12" rx="6.5" ry="7.5" transform="rotate(-14 -16 -12)" />
          <ellipse cx="0" cy="-19" rx="6.5" ry="7.5" />
          <ellipse cx="16" cy="-12" rx="6.5" ry="7.5" transform="rotate(14 16 -12)" />
        </g>
      ))}
      <circle cx="366" cy="46" r="5.5" fill="none" stroke="var(--cat-orange)" strokeWidth="2.5" />
      <circle cx="366" cy="46" r="2" fill="var(--cat-orange)" />
    </svg>
  );
}

export function AuthPage({ theme, onAuthed }: { theme: 'night' | 'day'; onAuthed: (username: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
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
      <div className="authsplit">
        {/* 品牌展示区 */}
        <div className="authshow">
          <img className="authshow__logo" src="/brand/logo-icon.png?v=3" alt="" />
          <h1 className="authshow__brand">
            猫踪<span>CAT TRAIL</span>
          </h1>
          <p className="authshow__slogan">
            你的每一次骑行，
            <br />
            都是这座城市里猫的踪迹
          </p>
          <RouteArt />
          <ul className="authshow__feats">
            <li>🐾 数据按账号隔离，只有你能看到自己的骑行</li>
            <li>🚴 一键同步 iGPSPORT 码表，支持 FIT 导入</li>
            <li>🗺 足迹地图 · 猫径 · 年度骑行打卡</li>
          </ul>
        </div>

        {/* 表单区 */}
        <div className="authform">
          <div className="authform__tabs" role="tablist">
            <span className={`authform__thumb${mode === 'register' ? ' right' : ''}`} aria-hidden />
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')} role="tab" aria-selected={mode === 'login'}>
              登录
            </button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')} role="tab" aria-selected={mode === 'register'}>
              注册
            </button>
          </div>

          <label className="infield">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              <circle cx="8" cy="5" r="3.2" />
              <path d="M1.8 14.4c.9-2.9 3.3-4.4 6.2-4.4s5.3 1.5 6.2 4.4" />
            </svg>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名（2-32 个字符）"
              autoComplete="username"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          <label className="infield">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              <rect x="2.5" y="6.5" width="11" height="7.5" rx="2" />
              <path d="M5 6.5V4.8a3 3 0 0 1 6 0v1.7M8 9.6v1.8" />
            </svg>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? '设置密码（至少 6 位）' : '密码'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button
              type="button"
              className="infield__eye"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? '隐藏密码' : '显示密码'}
            >
              {showPw ? (
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                  <path d="M2 8c1.8-3 4-4.4 6-4.4S12.2 5 14 8c-1.8 3-4 4.4-6 4.4S3.8 11 2 8Z" />
                  <circle cx="8" cy="8" r="1.9" />
                  <path d="M2.5 13.5 13.5 2.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                  <path d="M2 8c1.8-3 4-4.4 6-4.4S12.2 5 14 8c-1.8 3-4 4.4-6 4.4S3.8 11 2 8Z" />
                  <circle cx="8" cy="8" r="1.9" />
                </svg>
              )}
            </button>
          </label>

          {err && <div className="authform__err">{err}</div>}

          <button className="authform__submit" disabled={busy || !username.trim() || !password.trim()} onClick={submit}>
            {busy ? '请稍候…' : mode === 'login' ? '登 录' : '注册并进入'}
          </button>

          {mode === 'register' && (
            <p className="authform__note">首个注册的账号会认领服务器里已有的历史骑行数据</p>
          )}
        </div>
      </div>
    </div>
  );
}
