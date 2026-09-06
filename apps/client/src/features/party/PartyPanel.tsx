import { useEffect, useState } from 'react';
import { ArtImage } from '../../art/ArtImage';
import { Button, Field, Panel, ProgressBar } from '../../design';
import { useCharacterStore } from '../../store/character';
import { usePartyStore } from '../../store/party';
import { toast, useUiStore } from '../../store/ui';
import { copyText } from './clipboard';
import './party.css';

export function PartyPanel() {
  const party = usePartyStore((state) => state.party);
  const busy = usePartyStore((state) => state.busy);
  const loading = usePartyStore((state) => state.loading);
  const load = usePartyStore((state) => state.load);
  const create = usePartyStore((state) => state.create);
  const join = usePartyStore((state) => state.join);
  const leave = usePartyStore((state) => state.leave);
  const kick = usePartyStore((state) => state.kick);
  const openProfile = useUiStore((state) => state.openProfile);
  const selfId = useCharacterStore((state) => state.view?.character.id ?? null);
  const [code, setCode] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  if (!party) {
    return (
      <div className="party">
        <Panel title="独行" aside={loading ? '查阅中……' : undefined}>
          <p className="field__hint" style={{ marginBottom: 'var(--sp-4)' }}>
            秘境的妖王气血是同阶妖兽的四倍，围攻的血池也要几个人轮着打。
            立一支队伍，把六位邀请码给道友。
          </p>
          <Button variant="primary" block disabled={busy} onClick={() => void create()}>
            {busy ? '结阵中……' : '立一支队伍'}
          </Button>
        </Panel>

        <Panel title="投帖入队">
          <form
            className="party__join"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim()) void join(code).then((ok) => ok && setCode(''));
            }}
          >
            <Field
              label="邀请码"
              value={code}
              maxLength={12}
              autoComplete="off"
              placeholder="六位"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            <Button variant="ghost" type="submit" disabled={busy || code.trim().length < 4}>
              入队
            </Button>
          </form>
        </Panel>
      </div>
    );
  }

  const isLeader = party.leaderId === selfId;
  const empties = Math.max(0, party.maxSize - party.members.length);

  return (
    <div className="party">
      <section className="code-seal">
        <span className="code-seal__label">邀请码</span>
        <strong className="code-seal__code">{party.code}</strong>
        <p className="code-seal__note">
          道友在「同道 › 组队」里输入此码即可入队。队伍 {party.members.length}/{party.maxSize} 人。
        </p>
        <Button
          variant="quiet"
          size="sm"
          className="code-seal__copy"
          onClick={() => {
            void copyText(party.code).then((ok) =>
              toast(ok ? `已抄下 ${party.code}` : `手抄一下：${party.code}`, ok ? 'gain' : 'info'),
            );
          }}
        >
          抄走邀请码
        </Button>
      </section>

      <Panel title="同行">
        <div className="roster">
          {party.members.map((member) => (
            <div
              className={`roster__row ${member.online ? '' : 'roster__row--off'}`}
              key={member.characterId}
            >
              <button
                type="button"
                className="roster__art"
                aria-label={`查看 ${member.name}`}
                onClick={() => openProfile(member.characterId)}
              >
                <ArtImage id={member.avatarArt} label="" motif="portrait" />
              </button>
              <div className="roster__body">
                <span className="roster__name">
                  {member.online && <span className="online-dot" aria-label="在线" />}
                  {member.name}
                  {member.isLeader && <span className="leader-seal">长</span>}
                  {member.characterId === selfId && <span className="tag">我</span>}
                </span>
                <span className="roster__sub">
                  <span>{member.stageName}</span>
                  <span className="numeral">战力 {member.powerScore.toLocaleString('zh-CN')}</span>
                </span>
                <span className="roster__hp">
                  气血
                  <ProgressBar
                    value={member.hpPercent}
                    tone={member.hpPercent > 0.3 ? 'cinnabar' : 'ink'}
                    thin
                    label={`${member.name} 气血`}
                  />
                  <span className="numeral">{Math.round(member.hpPercent * 100)}%</span>
                </span>
              </div>
              {isLeader && member.characterId !== selfId && (
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={busy}
                  onClick={() => void kick(member.characterId)}
                >
                  请离
                </Button>
              )}
            </div>
          ))}

          {Array.from({ length: empties }, (_, i) => (
            <div className="roster__slot" key={`empty-${i}`}>
              <span className="roster__slot-mark" aria-hidden="true">
                空
              </span>
              <span>虚位以待</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="party__foot">
        <Button variant="ghost" disabled={busy} onClick={() => void leave()}>
          {isLeader ? '解散队伍' : '离队'}
        </Button>
      </div>
    </div>
  );
}
