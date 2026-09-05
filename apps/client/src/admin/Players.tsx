import { useState } from 'react';
import {
  BREAKTHROUGH_PILL_ID,
  ITEMS,
  MAX_STAGE_INDEX,
  stageName,
  type ItemKind,
  type PlayerSummary,
} from '@xianxia/shared';
import { errorMessage } from '../api/http';
import { adminApi } from './api';
import {
  NumField,
  Notice,
  Pager,
  Section,
  SelectField,
  stamp,
  TableScroll,
  TextField,
  useAsync,
} from './ui';

/**
 * 玩家.
 *
 * Three acts live behind each row, in rising order of consequence: hand
 * something over, reset a password, close the gate. They are laid out in that
 * order and the last one asks twice, because a ban also cuts the live socket.
 */

const PAGE_SIZE = 20;

const KIND_LABELS: Record<ItemKind, string> = {
  pill: '丹药',
  material: '材料',
  equipment: '法宝',
};

const ITEM_OPTIONS = ITEMS.map((item) => ({
  value: item.id,
  label: `${item.name} · ${KIND_LABELS[item.kind]}`,
}));

export function Players() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [onlyBanned, setOnlyBanned] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const key = `${page}|${q}|${onlyBanned}`;
  const players = useAsync(
    () =>
      adminApi.players({
        page,
        pageSize: PAGE_SIZE,
        ...(q ? { q } : {}),
        ...(onlyBanned ? { onlyBanned: true } : {}),
      }),
    key,
  );

  const replace = (next: PlayerSummary): void => {
    if (!players.data) return;
    players.set({
      ...players.data,
      items: players.data.items.map((p) => (p.userId === next.userId ? next : p)),
    });
  };

  return (
    <Section
      title="玩家"
      lede="每个账号一行。点开可发放、重置密码或封禁。"
      actions={
        <button
          type="button"
          className="adm-btn adm-btn--quiet"
          onClick={() => {
            players.reload();
            setOpenId(null);
          }}
        >
          重读
        </button>
      }
    >
      {flash ? <Notice tone="done">{flash}</Notice> : null}
      {players.error ? <Notice tone="warn">{players.error}</Notice> : null}

      <div className="adm-filters">
        <label className="adm-filter">
          <span className="adm-filter__label">搜用户名</span>
          <input
            className="adm-input"
            value={q}
            placeholder="输入用户名片段"
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="adm-check">
          <input
            type="checkbox"
            checked={onlyBanned}
            onChange={(event) => {
              setOnlyBanned(event.target.checked);
              setPage(1);
            }}
          />
          只看已封禁
        </label>
      </div>

      <TableScroll>
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">用户名</th>
              <th scope="col">道号</th>
              <th scope="col">境界</th>
              <th scope="col">战力</th>
              <th scope="col">灵石</th>
              <th scope="col">状态</th>
              <th scope="col">注册于</th>
              <th scope="col">最后在线</th>
            </tr>
          </thead>
          <tbody>
            {(players.data?.items ?? []).map((player) => (
              <PlayerRow
                key={player.userId}
                player={player}
                open={openId === player.userId}
                onToggle={() =>
                  setOpenId((current) => (current === player.userId ? null : player.userId))
                }
                onFlash={setFlash}
                onReplace={replace}
              />
            ))}
            {players.data && players.data.items.length === 0 ? (
              <tr>
                <td colSpan={8} className="adm-empty">
                  {q || onlyBanned ? '没有符合条件的账号。' : '还没有人注册。'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </TableScroll>

      {players.data ? (
        <Pager
          page={players.data.page}
          pageSize={players.data.pageSize}
          total={players.data.total}
          onPage={setPage}
        />
      ) : null}
    </Section>
  );
}

function PlayerRow({
  player,
  open,
  onToggle,
  onFlash,
  onReplace,
}: {
  player: PlayerSummary;
  open: boolean;
  onToggle: () => void;
  onFlash: (text: string) => void;
  onReplace: (next: PlayerSummary) => void;
}) {
  return (
    <>
      <tr className={`adm-row${open ? ' is-open' : ''}${player.banned ? ' is-banned' : ''}`}>
        <th scope="row" className="adm-row__name">
          <button type="button" className="adm-row__toggle" onClick={onToggle} aria-expanded={open}>
            <span className="adm-row__chevron" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            {player.username}
          </button>
        </th>
        <td>{player.characterName ?? <span className="adm-cell--soft">未建角色</span>}</td>
        <td>{player.stageName ?? '—'}</td>
        <td className="numeral">{player.powerScore ?? '—'}</td>
        <td className="numeral">{player.spiritStones ?? '—'}</td>
        <td>
          <span className="adm-tags">
            {player.banned ? <span className="adm-tag adm-tag--warn">已封禁</span> : null}
            {player.online ? <span className="adm-tag adm-tag--live">在线</span> : null}
            {player.isAdmin ? <span className="adm-tag">管理员</span> : null}
            {!player.banned && !player.online && !player.isAdmin ? (
              <span className="adm-cell--soft">离线</span>
            ) : null}
          </span>
        </td>
        <td className="numeral adm-cell--soft">{stamp(player.createdAt)}</td>
        <td className="numeral adm-cell--soft">{stamp(player.lastSeenAt)}</td>
      </tr>
      {open ? (
        <tr className="adm-row__drawer">
          <td colSpan={8}>
            <PlayerActions player={player} onFlash={onFlash} onReplace={onReplace} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PlayerActions({
  player,
  onFlash,
  onReplace,
}: {
  player: PlayerSummary;
  onFlash: (text: string) => void;
  onReplace: (next: PlayerSummary) => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [itemId, setItemId] = useState(BREAKTHROUGH_PILL_ID);
  const [qty, setQty] = useState(1);
  const [exp, setExp] = useState(0);
  const [stones, setStones] = useState(0);
  const [stageIndex, setStageIndex] = useState<number | null>(null);

  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [confirmingBan, setConfirmingBan] = useState(false);

  const guard = async (job: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await job();
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const grant = (): Promise<void> =>
    guard(async () => {
      if (!player.characterId) throw new Error('这个账号还没有角色，无法发放。');
      const state = await adminApi.grant({
        characterId: player.characterId,
        ...(exp > 0 ? { exp } : {}),
        ...(stones !== 0 ? { spiritStones: stones } : {}),
        ...(stageIndex !== null ? { stageIndex } : {}),
        ...(qty > 0 ? { items: [{ itemId, qty }] } : {}),
      });
      const item = ITEMS.find((i) => i.id === itemId);
      const parts: string[] = [];
      if (qty > 0 && item) parts.push(`${item.name} ×${qty}`);
      if (exp > 0) parts.push(`修为 ${exp}`);
      if (stones !== 0) parts.push(`灵石 ${stones}`);
      if (stageIndex !== null) parts.push(`境界 ${stageName(stageIndex)}`);
      onFlash(`已发放给 ${player.characterName ?? player.username}：${parts.join('、')}。`);
      onReplace({
        ...player,
        stageIndex: state.stageIndex,
        stageName: stageName(state.stageIndex),
        powerScore: state.powerScore,
        spiritStones: state.spiritStones,
      });
      setExp(0);
      setStones(0);
      setStageIndex(null);
    });

  const resetPassword = (): Promise<void> =>
    guard(async () => {
      await adminApi.resetPassword({ userId: player.userId, newPassword: password });
      onFlash(`${player.username} 的密码已重置，其所有登录会话已失效。`);
      setPassword('');
    });

  const setBan = (banned: boolean): Promise<void> =>
    guard(async () => {
      const next = await adminApi.ban({
        userId: player.userId,
        banned,
        ...(banned && reason ? { reason } : {}),
      });
      onReplace(next);
      onFlash(banned ? `${player.username} 已封禁并被踢下线。` : `${player.username} 已解封。`);
      setConfirmingBan(false);
      setReason('');
    });

  return (
    <div className="adm-editor">
      {failure ? <Notice tone="warn">{failure}</Notice> : null}

      <h4 className="adm-editor__title">发放</h4>
      {player.characterId ? null : (
        <Notice>这个账号尚未创建角色，暂时无法发放修为、灵石或道具。</Notice>
      )}
      <div className="adm-grid">
        <SelectField label="物品" value={itemId} onChange={setItemId} options={ITEM_OPTIONS} />
        <NumField label="数量" value={qty} onChange={setQty} min={0} max={999} step={1} unit="个" />
        <NumField
          label="修为"
          value={exp}
          onChange={setExp}
          min={0}
          max={1_000_000}
          step={100}
          hint="按小境界自动升级，圆满处停住等待突破。"
        />
        <NumField
          label="灵石"
          value={stones}
          onChange={setStones}
          min={-1_000_000}
          max={1_000_000}
          step={100}
          hint="可填负数扣除，结果不会低于零。"
        />
      </div>
      <div className="adm-grid">
        <label className="adm-check">
          <input
            type="checkbox"
            checked={stageIndex !== null}
            onChange={(event) => setStageIndex(event.target.checked ? (player.stageIndex ?? 0) : null)}
          />
          直接改境界
        </label>
        {stageIndex !== null ? (
          <NumField
            label="境界"
            value={stageIndex}
            onChange={setStageIndex}
            min={0}
            max={MAX_STAGE_INDEX}
            step={1}
            dirty
            hint={stageName(stageIndex)}
          />
        ) : null}
      </div>
      <div className="adm-editor__foot">
        <span className="adm-editor__id numeral">{player.characterId ?? player.userId}</span>
        <button
          type="button"
          className="adm-btn adm-btn--seal"
          onClick={() => void grant()}
          disabled={busy || !player.characterId}
        >
          发放
        </button>
      </div>

      <hr className="hairline" />

      <h4 className="adm-editor__title">重置密码</h4>
      <div className="adm-grid">
        <TextField
          label="新密码"
          value={password}
          onChange={setPassword}
          type="password"
          hint="至少 6 位。重置后该账号的全部登录会话立即失效。"
        />
      </div>
      <div className="adm-editor__foot">
        <span className="adm-editor__id">请通过其它渠道把新密码告知本人。</span>
        <button
          type="button"
          className="adm-btn adm-btn--quiet"
          onClick={() => void resetPassword()}
          disabled={busy || password.length < 6}
        >
          重置
        </button>
      </div>

      <hr className="hairline" />

      <h4 className="adm-editor__title">{player.banned ? '解封' : '封禁'}</h4>
      {player.banned ? (
        <div className="adm-editor__foot">
          <span className="adm-editor__id">解封后该账号可立即重新登录。</span>
          <button
            type="button"
            className="adm-btn adm-btn--quiet"
            onClick={() => void setBan(false)}
            disabled={busy}
          >
            解封
          </button>
        </div>
      ) : (
        <>
          <div className="adm-grid">
            <TextField
              label="封禁理由"
              value={reason}
              onChange={setReason}
              maxLength={200}
              placeholder="会出现在该玩家的登录提示里"
            />
          </div>
          <div className="adm-editor__foot">
            {confirmingBan ? (
              <>
                <span className="adm-editor__warn">
                  封禁会立刻删除该账号的所有会话并切断连接。
                </span>
                <span className="adm-editor__actions">
                  <button
                    type="button"
                    className="adm-btn adm-btn--quiet"
                    onClick={() => setConfirmingBan(false)}
                    disabled={busy}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="adm-btn adm-btn--danger"
                    onClick={() => void setBan(true)}
                    disabled={busy}
                  >
                    确认封禁
                  </button>
                </span>
              </>
            ) : (
              <>
                <span className="adm-editor__id">封禁是立即生效的，玩家会被踢下线。</span>
                <button
                  type="button"
                  className="adm-btn adm-btn--quiet"
                  onClick={() => setConfirmingBan(true)}
                  disabled={busy}
                >
                  封禁
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
