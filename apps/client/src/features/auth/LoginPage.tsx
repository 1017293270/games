import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ArtImage } from '../../art/ArtImage';
import { Button, Field } from '../../design';
import { GAME_NAME, GAME_TAGLINE } from '../../config';
import { USE_MOCK } from '../../api/http';
import { useSessionStore } from '../../store/session';
import './auth.css';

type Mode = 'login' | 'register';

export function LoginPage() {
  const status = useSessionStore((state) => state.status);
  const busy = useSessionStore((state) => state.busy);
  const error = useSessionStore((state) => state.error);
  const login = useSessionStore((state) => state.login);
  const register = useSessionStore((state) => state.register);
  const clearError = useSessionStore((state) => state.clearError);
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => {
    clearError();
  }, [mode, clearError]);

  if (status === 'ready') return <Navigate to="/" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const okay =
      mode === 'login'
        ? await login(username.trim(), password)
        : await register(username.trim(), password, inviteCode.trim() || undefined);
    if (okay) navigate('/', { replace: true });
  };

  const fillDemo = () => {
    setMode('login');
    setUsername('qingyun');
    setPassword('qingyun123');
  };

  return (
    <div className="login">
      <div className="login__plate">
        <ArtImage id="bg/login" label="孤峰远影" motif="scene" small />
        <div className="login__inscription">
          <p className="login__tag">{GAME_TAGLINE}</p>
          <div className="login__title">
            <h1 className="login__wordmark">{GAME_NAME}</h1>
            <span className="login__seal" aria-hidden="true">
              道
            </span>
          </div>
        </div>
      </div>

      <form className="login__form" onSubmit={submit}>
        <div className="login__switch" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            onClick={() => setMode('register')}
          >
            注册
          </button>
        </div>

        <Field
          label="道号"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="3-20 位字母、数字或下划线"
          required
        />
        <Field
          label="密钥"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少 6 位"
          required
        />
        {mode === 'register' && (
          <Field
            label="邀请码"
            name="inviteCode"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            placeholder="没有可留空"
            hint="本服限量开放，持帖者优先入门。"
          />
        )}

        <p className="login__error" role="alert">
          {error ?? ''}
        </p>

        <Button variant="primary" block type="submit" disabled={busy}>
          {busy ? '推演中……' : mode === 'login' ? '入山门' : '录名入册'}
        </Button>

        {USE_MOCK && (
          <div className="login__demo">
            <span>演示模式：数据由本地推演，无需服务器</span>
            <Button variant="quiet" size="sm" onClick={fillDemo}>
              用演示道号
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
