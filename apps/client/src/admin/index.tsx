import { useEffect, useState } from 'react';
import { GAME_NAME } from '../config';
import { errorMessage } from '../api/http';
import { adminApi, readAdminToken, writeAdminToken } from './api';
import { Archetypes } from './Archetypes';
import { Bots } from './Bots';
import { Invites } from './Invites';
import { Overview } from './Overview';
import { Players } from './Players';
import { World } from './World';
import { stamp, useTicker } from './ui';
import './admin.css';

/**
 * 道录司 — the operator console.
 *
 * A records office, not a dashboard: ruled ledgers, tabular numerals, and a
 * 朱批 vermilion gutter wherever the operator has written something that is not
 * yet committed. It shares the game's paper and pigments but none of its
 * ornament — this is the one screen in the product that is a tool.
 *
 * It lives inside the same `InkFrame` as the game, and asks that leaf to widen
 * for the duration (see `admin.css`): a table of eleven columns is not a phone
 * screen, and an operator is at a desk.
 */

type TabId = 'overview' | 'world' | 'bots' | 'archetypes' | 'players' | 'invites';

const TABS: { id: TabId; seal: string; label: string }[] = [
  { id: 'overview', seal: '概', label: '概览' },
  { id: 'world', seal: '世', label: '世界' },
  { id: 'bots', seal: '机', label: '机器人' },
  { id: 'archetypes', seal: '原', label: '原型' },
  { id: 'players', seal: '玩', label: '玩家' },
  { id: 'invites', seal: '邀', label: '邀请码' },
];

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(() => readAdminToken());
  const [tab, setTab] = useState<TabId>('overview');
  const [username, setUsername] = useState('admin');

  useEffect(() => {
    document.title = `道录司 · ${GAME_NAME}`;
  }, []);

  const signOut = (): void => {
    writeAdminToken(null);
    setToken(null);
  };

  if (token === null) {
    return (
      <div className="admin admin--gate">
        <SignIn
          onSignedIn={(next, who) => {
            setToken(next);
            setUsername(who);
          }}
        />
      </div>
    );
  }

  return (
    <div className="admin">
      <Masthead username={username} onSignOut={signOut} />
      <div className="admin__body">
        <nav className="admin__rail" aria-label="后台分区">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`admin__tab${tab === entry.id ? ' is-on' : ''}`}
              aria-current={tab === entry.id ? 'page' : undefined}
              onClick={() => setTab(entry.id)}
            >
              <span className="admin__tab-seal" aria-hidden="true">
                {entry.seal}
              </span>
              <span className="admin__tab-label">{entry.label}</span>
            </button>
          ))}
        </nav>
        <main className="admin__content" key={tab}>
          {tab === 'overview' ? <Overview /> : null}
          {tab === 'world' ? <World /> : null}
          {tab === 'bots' ? <Bots /> : null}
          {tab === 'archetypes' ? <Archetypes /> : null}
          {tab === 'players' ? <Players /> : null}
          {tab === 'invites' ? <Invites /> : null}
        </main>
      </div>
    </div>
  );
}

function Masthead({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  const now = useTicker(1000);
  return (
    <header className="admin__masthead">
      <div className="admin__brand">
        <span className="admin__brand-seal" aria-hidden="true">
          录
        </span>
        <span>
          <h1 className="admin__brand-name ink-display">道录司</h1>
          <p className="admin__brand-sub">{GAME_NAME} 后台</p>
        </span>
      </div>
      <div className="admin__meta">
        <span className="numeral">{stamp(now)}</span>
        <span className="admin__who">{username}</span>
        <a className="admin__exit" href="/">
          回修炼场
        </a>
        <button type="button" className="adm-btn adm-btn--quiet" onClick={onSignOut}>
          退出
        </button>
      </div>
    </header>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (token: string, username: string) => void }) {
  const [name, setName] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const session = await adminApi.login({ username: name, password });
      writeAdminToken(session.token);
      onSignedIn(session.token, session.username);
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="admin-gate"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <span className="admin-gate__seal" aria-hidden="true">
        录
      </span>
      <h1 className="admin-gate__title ink-display">道录司</h1>
      <p className="admin-gate__lede">凭 ADMIN_PASSWORD 入内。此处可改动整个世界。</p>

      <label className="adm-field">
        <span className="adm-field__label">用户名</span>
        <input
          className="adm-input"
          value={name}
          autoComplete="username"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="adm-field">
        <span className="adm-field__label">密码</span>
        <input
          className="adm-input"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {failure ? (
        <p className="adm-notice adm-notice--warn" role="alert">
          {failure}
        </p>
      ) : null}

      <button
        type="submit"
        className="adm-btn adm-btn--seal adm-btn--block"
        disabled={busy || password.length === 0}
      >
        {busy ? '验牌中……' : '入内'}
      </button>
      <a className="admin-gate__back" href="/">
        回修炼场
      </a>
    </form>
  );
}
