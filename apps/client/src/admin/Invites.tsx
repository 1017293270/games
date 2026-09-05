import { useState } from 'react';
import type { Invite } from '@xianxia/shared';
import { errorMessage } from '../api/http';
import { adminApi } from './api';
import { NumField, Notice, Section, stamp, TableScroll, TextField, useAsync, useTicker } from './ui';

/**
 * 邀请码.
 *
 * Codes minted here are single use. The one written by the `INVITE_CODE`
 * environment variable is unlimited and is marked as such — the wire shape
 * (`Invite`) carries no remaining-use count, so the panel reads redemption
 * from `usedAt` and never claims a number it cannot know.
 */

const ENV_ISSUER = 'env:INVITE_CODE';

/** Days a "expires in N days" mint offers. */
const EXPIRY_CHOICES = [
  { days: 0, label: '永不过期' },
  { days: 1, label: '1 天' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
];

export function Invites() {
  const invites = useAsync(() => adminApi.invites(), 'invites');
  const [count, setCount] = useState(5);
  const [note, setNote] = useState('');
  const [expiryDays, setExpiryDays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const now = useTicker(30_000);

  const mint = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await adminApi.createInvites({
        count,
        note,
        expiresAt: expiryDays === 0 ? null : Date.now() + expiryDays * 86_400_000,
      });
      invites.set(result);
      setFlash(`已生成 ${count} 个邀请码，每个可用一次。`);
      setNote('');
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const retire = async (code: string): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await adminApi.deleteInvite(code);
      invites.set(result);
      setFlash(`${code} 已作废。`);
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const copy = (code: string): void => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => setCopied(code))
      .catch(() => setCopied(null));
  };

  const rows = invites.data?.invites ?? [];

  return (
    <>
      <Section title="发放" lede="每个码只能用一次。未开启「需要邀请码」时，注册不查码。">
        <div className="adm-grid">
          <NumField label="数量" value={count} onChange={setCount} min={1} max={100} step={1} unit="个" />
          <TextField
            label="备注"
            value={note}
            onChange={setNote}
            maxLength={100}
            placeholder="例如：首测第二批"
            hint="只给自己看，随码一起留档。"
          />
          <div className="adm-field">
            <span className="adm-field__label">有效期</span>
            <div className="adm-choices">
              {EXPIRY_CHOICES.map((choice) => (
                <button
                  key={choice.days}
                  type="button"
                  className={`adm-chip${expiryDays === choice.days ? ' is-on' : ''}`}
                  onClick={() => setExpiryDays(choice.days)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {failure ? <Notice tone="warn">{failure}</Notice> : null}
        <div className="adm-editor__foot">
          <span className="adm-editor__id">六位码，无元音，不会拼出词。</span>
          <button
            type="button"
            className="adm-btn adm-btn--seal"
            onClick={() => void mint()}
            disabled={busy}
          >
            {busy ? '刻印中……' : `生成 ${count} 个`}
          </button>
        </div>
      </Section>

      <Section
        title="名录"
        lede="按发放时间倒序。"
        actions={
          <button type="button" className="adm-btn adm-btn--quiet" onClick={invites.reload}>
            重读
          </button>
        }
      >
        {flash ? <Notice tone="done">{flash}</Notice> : null}
        {invites.error ? <Notice tone="warn">{invites.error}</Notice> : null}

        <TableScroll>
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">码</th>
                <th scope="col">状态</th>
                <th scope="col">备注</th>
                <th scope="col">发放人</th>
                <th scope="col">发放于</th>
                <th scope="col">过期</th>
                <th scope="col" className="adm-col--action">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invite) => (
                <tr className="adm-row" key={invite.code}>
                  <th scope="row">
                    <button
                      type="button"
                      className="adm-code"
                      onClick={() => copy(invite.code)}
                      title="点击复制"
                    >
                      {invite.code}
                      <span className="adm-code__hint">
                        {copied === invite.code ? '已复制' : '复制'}
                      </span>
                    </button>
                  </th>
                  <td>{statusOf(invite, now)}</td>
                  <td>{invite.note || <span className="adm-cell--soft">—</span>}</td>
                  <td className="adm-cell--soft">
                    {invite.createdBy === ENV_ISSUER ? '环境变量' : invite.createdBy}
                  </td>
                  <td className="numeral adm-cell--soft">{stamp(invite.createdAt)}</td>
                  <td className="numeral adm-cell--soft">
                    {invite.expiresAt === null ? '永不' : stamp(invite.expiresAt)}
                  </td>
                  <td className="adm-col--action">
                    <button
                      type="button"
                      className="adm-btn adm-btn--quiet"
                      onClick={() => void retire(invite.code)}
                      disabled={busy}
                    >
                      作废
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="adm-empty">
                    还没有邀请码。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScroll>
      </Section>
    </>
  );
}

function statusOf(invite: Invite, now: number) {
  if (invite.expiresAt !== null && invite.expiresAt <= now) {
    return <span className="adm-tag adm-tag--warn">已过期</span>;
  }
  if (invite.createdBy === ENV_ISSUER) {
    return (
      <span className="adm-tags">
        <span className="adm-tag adm-tag--live">常驻·不限次</span>
        {invite.usedAt !== null ? (
          <span className="adm-cell--soft numeral">最近 {stamp(invite.usedAt)}</span>
        ) : null}
      </span>
    );
  }
  if (invite.usedAt !== null) return <span className="adm-tag">已使用</span>;
  return <span className="adm-tag adm-tag--live">可用</span>;
}
