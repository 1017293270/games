import { useCallback, useEffect, useState } from 'react';
import { stageName, type ArtId, type QuestListResponse } from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { ArtImage } from '../../art/ArtImage';
import { CloudRule } from '../../design';
import { useCharacterStore } from '../../store/character';
import { toast } from '../../store/ui';
import { QuestPanel } from '../quest/QuestPanel';
import { ShopSheet } from '../shop/ShopSheet';
import { DialogueSheet } from './DialogueSheet';
import './town.css';

type Tab = 'people' | 'quests';

const TABS: { id: Tab; label: string }[] = [
  { id: 'people', label: '镇民' },
  { id: 'quests', label: '任务簿' },
];

interface NpcRow {
  id: string;
  name: string;
  title: string;
  description: string;
  art: string;
  shopId: string | null;
  unlockStage: number;
  unlocked: boolean;
  hasQuest: boolean;
}

/**
 * 青云镇.
 *
 * The town is the story's one fixed place: eight NPCs who hand out the three
 * chapters, take them back, and trade. Everything on this screen is the
 * server's answer — who will see you, who has business with you, what a branch
 * costs — so the page is a renderer with two sheets hanging off it.
 */
export function TownPage() {
  const view = useCharacterStore((state) => state.view);
  const [tab, setTab] = useState<Tab>('people');
  const [npcs, setNpcs] = useState<NpcRow[]>([]);
  const [quests, setQuests] = useState<QuestListResponse | null>(null);
  const [talking, setTalking] = useState<NpcRow | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [roster, log] = await Promise.all([api.npcs(), api.quests()]);
      setNpcs(roster.npcs);
      setQuests(log);
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Both sheets refetch on a changed callback identity, so these have to be
  // stable across the re-renders `reload` itself causes.
  const closeDialogue = useCallback(() => {
    setTalking(null);
    void reload();
  }, [reload]);

  const closeShop = useCallback(() => {
    setShopId(null);
    void reload();
  }, [reload]);

  const refresh = useCallback(() => {
    void reload();
  }, [reload]);

  const pending = npcs.filter((n) => n.hasQuest).length;

  return (
    <div className="town-page">
      <header className="page-head">
        <h1 className="page-head__title">青云镇</h1>
        <p className="page-head__note">
          {view ? `灵石 ${view.character.spiritStones.toLocaleString('zh-CN')}` : '——'}
          {pending > 0 ? ` · ${pending} 人有事相询` : ''}
        </p>
      </header>
      <CloudRule />

      <div className="segments" role="tablist" aria-label="青云镇分页">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`segment ${tab === entry.id ? 'segment--on' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="town-page__scroll">
        {tab === 'people' && (
          <>
            <p className="town-note">
              镇子不大，一条青石街走到头便是山门。街上的人各有各的事，也各有各的规矩。
            </p>
            <div className="town">
              {npcs.map((npc) => (
                <button
                  key={npc.id}
                  type="button"
                  className={`npc-card ${npc.unlocked ? '' : 'npc-card--locked'}`}
                  disabled={!npc.unlocked}
                  onClick={() => setTalking(npc)}
                >
                  <span className="npc-card__art">
                    <ArtImage id={npc.art as ArtId} label="" motif="portrait" small />
                  </span>
                  <span className="npc-card__body">
                    <span className="npc-card__name">{npc.name}</span>
                    <span className="npc-card__title">{npc.title}</span>
                    <span className="npc-card__desc">{npc.description}</span>
                    <span className="npc-card__foot">
                      {npc.unlocked ? (
                        <>
                          <span>叙话</span>
                          {npc.shopId && <span>· 交易</span>}
                        </>
                      ) : (
                        <span className="npc-card__lock">需 {stageName(npc.unlockStage)}</span>
                      )}
                    </span>
                  </span>
                  {npc.hasQuest && (
                    <span className="npc-card__mark" aria-label="有任务">
                      事
                    </span>
                  )}
                </button>
              ))}
              {npcs.length === 0 && <p className="empty">街上还没有人……</p>}
            </div>
          </>
        )}

        {tab === 'quests' && <QuestPanel quests={quests} onReload={reload} />}
      </div>

      {talking && (
        <DialogueSheet
          npcId={talking.id}
          npcTitle={talking.title}
          onClose={closeDialogue}
          onOpenShop={setShopId}
          onChanged={refresh}
        />
      )}

      {shopId && (
        <ShopSheet shopId={shopId} onClose={closeShop} onTraded={refresh} />
      )}
    </div>
  );
}
