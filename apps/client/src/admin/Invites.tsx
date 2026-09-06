import { useState } from 'react';
import type { Invite } from '@xianxia/shared';
import { errorMessage } from '../api/http';
import { adminApi } from './api';
import {
  NumField,
  Notice,
  Section,
  stamp,
  TableScroll,
  TextField,
  Toggle,
  useAsync,
  useTicker,
} from './ui';

/**
 * 邀请码.
 *
 * A code carries how many registrations it may serve (`maxUses`, -1 for
 * unlimited) and how many it has served (`uses`), so 名录 answers "how many
 * left" outright rather than inferring it from the last redemption. The code
 * written by the `INVITE_CODE` environment variable is one of the unlimited
 * kind; it is marked by its issuer, not by a special case in the counting.
 */

const ENV_ISSUER = 'env:INVITE_CODE';

/** `maxUses` value meaning "never runs out". */
const UNLIMITED = -1;

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
  const [maxUses, setMaxUses] = useState(1);
  const [unlimited, setUnlimited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const now = useTicker(30_000);

  const mint = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const uses = unlimited ? UNLIMITED : maxUses;
      const result = await adminApi.createInvites({
        count,
        note,
        maxUses: uses,
        expiresAt: expiryDays === 0 ? null : Date.now() + expiryDays * 86_400_000,
      });
      invites.set(result);
      setFlash(
        `已生成 ${count} 个邀请码，每个${uses === UNLIMITED ? '不限次数' : `可用 ${uses} 次`}。`,
      );
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
      <Section title="发放" lede="一次刻一批，每个码的可用次数单独设。未开启「需要邀请码」时，注册不查码。">
        <div className="adm-grid">
          <NumField label="数量" value={count} onChange={setCount} min={1} max={100} step={1} unit="个" />
          <NumField
            label="可用次数"
            value={unlimited ? 1 : maxUses}
            onChange={setMaxUses}
            min={1}
            max={1000}
            step={1}
            unit="次"
            disabled={unlimited}
            hint="每个码能注册几个账号。用满即失效。"
          />
          <Toggle
            label="不限次"
            value={unlimited}
            onChange={setUnlimited}
            hint="常驻码，永远用不完；和 INVITE_CODE 写入的那个同一种。"
          />
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
                <th scope="col">已用 / 可用</th>
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
                  <td className="numeral">
                    {invite.uses} / {invite.maxUses === UNLIMITED ? '∞' : invite.maxUses}
                  </td>
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
                  <td colSpan={8} className="adm-empty">
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

/**
 * The code's standing, in the order registration checks it: expiry first, then
 * the use count. The last redemption's timestamp rides along on any code that
 * has been used at least once, because on a multi-use code it is the only sign
 * of whether the batch is still being handed out.
 */
function statusOf(invite: Invite, now: number) {
  if (invite.expiresAt !== null && invite.expiresAt <= now) {
    return <span className="adm-tag adm-tag--warn">已过期</span>;
  }

  const unlimited = invite.maxUses === UNLIMITED;
  const left = unlimited ? Infinity : Math.max(0, invite.maxUses - invite.uses);
  const last =
    invite.usedAt === null ? null : (
      <span className="adm-cell--soft numeral">最近 {stamp(invite.usedAt)}</span>
    );

  if (left === 0) {
    return (
      <span className="adm-tags">
        <span className="adm-tag">已用尽</span>
        {last}
      </span>
    );
  }

  return (
    <span className="adm-tags">
      <span className="adm-tag adm-tag--live">
        {unlimited
          ? invite.createdBy === ENV_ISSUER
            ? '常驻·不限次'
            : '不限次'
          : `可用 ${left} 次`}
      </span>
      {last}
    </span>
  );
}
