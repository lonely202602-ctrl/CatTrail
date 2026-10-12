/** 设置页：iGPSPORT 账号绑定/换绑/解绑 + 手动同步触发 + 退出登录 */
import { useEffect, useState } from 'react';
import {
  clearIgpsportSettings, clearToken, fetchIgpsportSettings, getJob, saveIgpsportSettings, startSync,
  type IgpsportSettings,
} from '../data/adapter';
import { PageDecor } from './AuthPage';

export function SettingsPage({
  username,
  onDataChanged,
}: {
  username: string | null;
  onDataChanged: () => void;
}) {
  const [status, setStatus] = useState<IgpsportSettings | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [igpUser, setIgpUser] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /** 进行中的同步任务（后台执行，可离开本页） */
  const [syncJob, setSyncJob] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 轮询后台同步任务状态，完成/失败自动收尾并刷新数据
  useEffect(() => {
    if (!syncJob) return;
    const iv = setInterval(async () => {
      try {
        const j = await getJob(syncJob);
        if (j.status === 'done') {
          clearInterval(iv);
          setSyncJob(null);
          const r = j.result!;
          setSyncMsg({ ok: true, text: `同步完成：拉取 ${r.fetched} 条，新增 ${r.added}，跳过 ${r.skipped}，总里程 ${r.totalKm} km` });
          onDataChanged();
        } else if (j.status === 'error') {
          clearInterval(iv);
          setSyncJob(null);
          setSyncMsg({ ok: false, text: `同步失败：${j.error ?? '未知错误'}` });
        }
      } catch { /* 轮询失败下次再试 */ }
    }, 2000);
    return () => clearInterval(iv);
  }, [syncJob, onDataChanged]);

  const load = () => {
    fetchIgpsportSettings().then(setStatus).catch((e) => setLoadErr(String((e as Error).message)));
  };
  useEffect(load, []);

  const bind = async () => {
    if (!igpUser.trim() || !password.trim()) {
      setMsg({ ok: false, text: '请填写账号与密码' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const s = await saveIgpsportSettings(igpUser.trim(), password);
      setStatus(s);
      setPassword('');
      setMsg({ ok: true, text: `已绑定 ${s.username}，可以去「立即同步」拉取骑行数据了` });
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setSaving(false);
    }
  };

  const unbind = async () => {
    if (!window.confirm('确定解绑当前 iGPSPORT 账号？解绑后「在线同步」将不可用（已入库数据不受影响）。')) return;
    try {
      await clearIgpsportSettings();
      load();
      setMsg({ ok: true, text: '已解绑' });
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    }
  };

  const sync = async () => {
    setSyncMsg(null);
    try {
      const { jobId } = await startSync();
      setSyncJob(jobId); // 后台执行，轮询收尾；期间可自由离开本页
    } catch (e) {
      setSyncMsg({ ok: false, text: String((e as Error).message) });
    }
  };

  const bound = status?.bound ?? false;

  return (
    <div className="settings">
      <PageDecor />
      <header className="settings__head">
        <h2>设置</h2>
        <p className="settings__sub">
          {username ? `喵，${username}！` : ''}绑定码表账号后，骑行数据会自动同步进猫踪
        </p>
      </header>

      <section className="card">
        <div className="card__head">
          <span className="card__title">iGPSPORT 账号</span>
          {status && (
            <span className={`card__badge ${bound ? 'ok' : 'off'}`}>
              {bound ? `已绑定 · ${status.username}` : '未绑定'}
            </span>
          )}
        </div>

        {loadErr && <div className="settings__msg err">{loadErr}</div>}

        <label className="field">
          <span>账号（手机号 / 邮箱）</span>
          <input
            value={igpUser}
            onChange={(e) => setIgpUser(e.target.value)}
            placeholder="iGPSPORT App 的登录账号"
            autoComplete="username"
          />
        </label>
        <label className="field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={bound ? '已绑定；留空则不修改（换绑需重新填写）' : 'iGPSPORT App 的登录密码'}
            autoComplete="new-password"
          />
        </label>

        {msg && <div className={`settings__msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

        <div className="settings__row">
          <button className="btn-primary" disabled={saving || !igpUser.trim() || !password.trim()} onClick={bind}>
            {saving ? '绑定中…' : bound ? '换绑' : '绑定'}
          </button>
          {bound && status?.source === 'stored' && (
            <button className="btn-ghost" onClick={unbind}>解绑</button>
          )}
        </div>
        <p className="settings__note">
          凭据只保存在你自己部署的服务器本地（.cache/igpsport-auth.json，base64 混淆、不入仓库），
          浏览器不保存密码；同步走 iGPSPORT 官方接口，约 1 秒/条限频。
        </p>
      </section>

      <section className="card">
        <div className="card__head">
          <span className="card__title">数据同步</span>
          {bound && <span className="card__badge ok">在线</span>}
        </div>
        <p className="settings__desc">
          从 iGPSPORT 云端拉取全部骑行（增量，已入库的自动跳过），并刷新地图 / 热力图 / 猫径。
        </p>
        {syncMsg && <div className={`settings__msg ${syncMsg.ok ? 'ok' : 'err'}`}>{syncMsg.text}</div>}
        <div className="settings__row">
          <button className="btn-primary" disabled={!bound || !!syncJob} onClick={sync}>
            {syncJob ? '⟳ 同步中…后台执行，可离开本页' : '⟳ 立即同步'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <span className="card__title">手动导入</span>
        </div>
        <p className="settings__desc">
          没绑账号也能用：把码表导出的 .fit 文件拖到「骑行历史」页右上角的导入框即可入库
          （rideId 取起点时间，同一次骑行重传自动覆盖）。
        </p>
      </section>

      <section className="card">
        <div className="card__head">
          <span className="card__title">账号</span>
          {username && <span className="card__badge ok">{username}</span>}
        </div>
        <p className="settings__desc">骑行数据按账号隔离，只有登录你自己账号才能看到。</p>
        <div className="settings__row">
          <button
            className="btn-ghost"
            onClick={async () => {
              await clearToken();
              window.location.reload();
            }}
          >
            退出登录
          </button>
        </div>
      </section>
    </div>
  );
}
