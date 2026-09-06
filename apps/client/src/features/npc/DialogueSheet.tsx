import { useCallback, useEffect, useState } from 'react';
import type { ArtId, DialogueView } from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { ArtImage } from '../../art/ArtImage';
import { Sheet } from '../../design';
import { useCharacterStore } from '../../store/character';
import { toast } from '../../store/ui';
import './town.css';

export interface DialogueSheetProps {
  npcId: string;
  npcTitle: string;
  onClose: () => void;
  /** Fired when a branch carries `open_shop`. */
  onOpenShop: (shopId: string) => void;
  /** Fired whenever a turn the server ran might have moved a quest. */
  onChanged?: () => void;
}

/**
 * One conversation.
 *
 * Which branches exist, whether they are takeable and what taking one does are
 * all the server's answer — this only draws `choices` and posts the id back.
 * `ended` is the server's word that the talk is over; the sheet stays up on it
 * with the NPC's parting line and a single 告辞, rather than vanishing before
 * that line can be read.
 */
export function DialogueSheet({
  npcId,
  npcTitle,
  onClose,
  onOpenShop,
  onChanged,
}: DialogueSheetProps) {
  const setView = useCharacterStore((state) => state.setView);
  const [dialogue, setDialogue] = useState<DialogueView | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback(
    (next: DialogueView) => {
      setDialogue(next);
      setView(next.view);
      if (next.reward) {
        const parts = [
          next.reward.exp > 0 ? `修为 +${next.reward.exp.toLocaleString('zh-CN')}` : '',
          next.reward.spiritStones > 0 ? `灵石 +${next.reward.spiritStones}` : '',
          ...next.reward.itemNames,
        ].filter(Boolean);
        if (parts.length > 0) toast(`所得 ${parts.join('，')}`, 'gain');
      }
      onChanged?.();
    },
    [setView, onChanged],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await api.npcDialogue(npcId);
        if (cancelled) return;
        setDialogue(next);
        setView(next.view);
      } catch (error) {
        if (cancelled) return;
        toast(errorMessage(error), 'warn');
        onClose();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only the NPC identity restarts a conversation; `setView` and `onClose`
    // are stable for the sheet's lifetime.
  }, [npcId, setView, onClose]);

  const choose = async (choiceId: string) => {
    if (!dialogue) return;
    setBusy(true);
    try {
      const next = await api.npcTalk({ npcId, nodeId: dialogue.node.id, choiceId });
      apply(next);
      // A branch that opens a shop hands the screen over to it.
      if (next.openShopId) {
        onOpenShop(next.openShopId);
        onClose();
        return;
      }
      // Anything else that ends the talk leaves the sheet up on `ended`, so the
      // parting line can actually be read before 告辞 closes it.
    } catch (error) {
      toast(errorMessage(error), 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title={dialogue?.npcName ?? npcTitle} onClose={onClose}>
      {!dialogue ? (
        <p className="empty">正在见礼……</p>
      ) : (
        <div>
          <p className="dialogue__role">{npcTitle}</p>

          <div className="dialogue__stage">
            <div className="dialogue__portrait">
              <ArtImage id={dialogue.npcArt as ArtId} label="" motif="portrait" small />
            </div>
            <p className="dialogue__line">{dialogue.node.text}</p>
          </div>

          {dialogue.reward && (
            <div className="dialogue__spoils">
              {dialogue.reward.exp > 0 && (
                <span className="dialogue__spoil">
                  修为 +{dialogue.reward.exp.toLocaleString('zh-CN')}
                </span>
              )}
              {dialogue.reward.spiritStones > 0 && (
                <span className="dialogue__spoil">灵石 +{dialogue.reward.spiritStones}</span>
              )}
              {dialogue.reward.itemNames.map((name) => (
                <span className="dialogue__spoil" key={name}>
                  {name}
                </span>
              ))}
            </div>
          )}

          {/*
            Once the conversation is over, the NPC's parting line stands alone:
            re-offering the branches the player just declined would read as the
            talk never having ended.
          */}
          <div className="dialogue__choices">
            {dialogue.ended ? (
              <button type="button" className="town-choice town-choice--part" onClick={onClose}>
                告辞
              </button>
            ) : (
              dialogue.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="town-choice"
                  disabled={busy || !choice.available}
                  onClick={() => void choose(choice.id)}
                >
                  {choice.text}
                  {choice.blockedReason && (
                    <span className="town-choice__gate">{choice.blockedReason}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
