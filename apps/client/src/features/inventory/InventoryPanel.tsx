import {
  EQUIP_SLOTS,
  EQUIP_SLOT_NAMES,
  ITEM_BY_ID,
  ITEM_GRADE_NAMES,
  stageName,
  type CharacterView,
  type EquipSlot,
  type InventoryItem,
} from '@xianxia/shared';
import { ArtImage } from '../../art/ArtImage';
import { Button, Panel, StoneMark } from '../../design';
import { useInventoryStore } from '../../store/inventory';
import '../character/character.css';

/** Bag rows sort by kind so gear, pills and materials do not interleave. */
const KIND_ORDER = { equipment: 0, pill: 1, material: 2 } as const;

export function InventoryPanel({ view }: { view: CharacterView }) {
  const useItem = useInventoryStore((state) => state.use);
  const equip = useInventoryStore((state) => state.equip);
  const unequip = useInventoryStore((state) => state.unequip);

  const rowByUid = new Map(view.inventory.map((row) => [row.uid, row]));
  const bag = [...view.inventory].sort((a, b) => {
    const ka = ITEM_BY_ID.get(a.itemId)?.kind ?? 'material';
    const kb = ITEM_BY_ID.get(b.itemId)?.kind ?? 'material';
    return KIND_ORDER[ka] - KIND_ORDER[kb];
  });

  const actionFor = (row: InventoryItem) => {
    const item = ITEM_BY_ID.get(row.itemId);
    if (!item) return null;
    if (item.kind === 'pill') {
      if (item.effect.type === 'breakthrough_aid') {
        return <span className="skill-row__tag">突破时用</span>;
      }
      return (
        <Button size="sm" onClick={() => void useItem(row.uid)}>
          服下
        </Button>
      );
    }
    if (item.kind === 'equipment') {
      if (row.equipped) {
        return (
          <Button size="sm" variant="quiet" onClick={() => void unequip(item.slot)}>
            卸下
          </Button>
        );
      }
      const gated = view.character.stageIndex < item.requiredStage;
      return gated ? (
        <span className="skill-row__tag">需 {stageName(item.requiredStage)}</span>
      ) : (
        <Button size="sm" onClick={() => void equip(row.uid)}>
          装备
        </Button>
      );
    }
    return <span className="skill-row__tag">材料</span>;
  };

  return (
    <>
      <Panel title="随身" aside={
        <span className="topbar__stone-count numeral">
          <StoneMark />
          {view.character.spiritStones.toLocaleString('zh-CN')}
        </span>
      }>
        <div className="equip-grid">
          {EQUIP_SLOTS.map((slot: EquipSlot) => {
            const uid = view.character.equipment[slot];
            const row = uid ? rowByUid.get(uid) : undefined;
            const item = row ? ITEM_BY_ID.get(row.itemId) : undefined;
            return (
              <div className={`equip-slot ${item ? '' : 'equip-slot--empty'}`} key={slot}>
                <span className="equip-slot__art">
                  {item ? (
                    <ArtImage id={item.art} label="" motif="token" />
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </span>
                <span className="equip-slot__k">{EQUIP_SLOT_NAMES[slot]}</span>
                <span className="equip-slot__v">{item?.name ?? '未着'}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="行囊" aside={`${bag.length} 格`}>
        {bag.length === 0 ? (
          <p className="empty">囊中空空。去山野间走一趟吧。</p>
        ) : (
          <div className="item-list">
            {bag.map((row) => {
              const item = ITEM_BY_ID.get(row.itemId);
              if (!item) return null;
              return (
                <div className="item-row" key={row.uid}>
                  <span className="item-row__art">
                    <ArtImage id={item.art} label="" motif="token" />
                  </span>
                  <span className="item-row__body">
                    <span className="item-row__name">
                      {item.name}
                      {row.qty > 1 && <span className="muted numeral"> ×{row.qty}</span>}
                      <span className={`grade-mark grade-mark--${item.grade}`}>
                        {ITEM_GRADE_NAMES[item.grade]}
                      </span>
                      {row.equipped && <span className="skill-row__tag"> · 已着</span>}
                    </span>
                    <span className="item-row__desc muted">{item.description}</span>
                  </span>
                  <span className="bag-actions">{actionFor(row)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
