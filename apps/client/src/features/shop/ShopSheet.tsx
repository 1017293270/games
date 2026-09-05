import { useCallback, useEffect, useState } from 'react';
import { ITEM_BY_ID, type ShopView } from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { ArtImage } from '../../art/ArtImage';
import { Button, Sheet } from '../../design';
import { useCharacterStore } from '../../store/character';
import { toast } from '../../store/ui';
import './shop.css';

export interface ShopSheetProps {
  shopId: string;
  onClose: () => void;
  /** Fired after a trade, so a 收集 quest's progress can be refreshed. */
  onTraded?: () => void;
}

type Tab = 'buy' | 'sell';

/**
 * 买卖.
 *
 * Prices, stock and what the shop is even willing to take are all decided
 * server-side; the sheet posts a quantity and redraws whatever comes back.
 */
export function ShopSheet({ shopId, onClose, onTraded }: ShopSheetProps) {
  const view = useCharacterStore((state) => state.view);
  const setView = useCharacterStore((state) => state.setView);
  const [shop, setShop] = useState<ShopView | null>(null);
  const [tab, setTab] = useState<Tab>('buy');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setShop(await api.shop(shopId));
    } catch (error) {
      toast(errorMessage(error), 'warn');
      onClose();
    }
  }, [shopId, onClose]);

  useEffect(() => {
    void load();
  }, [load]);

  const step = (key: string, delta: number, max: number) => {
    setQty((current) => {
      const next = Math.max(1, Math.min(max, (current[key] ?? 1) + delta));
      return { ...current, [key]: next };
    });
  };

  const trade = async (kind: Tab, key: string, id: string, amount: number) => {
    setBusy(true);
    try {
      const result =
        kind === 'buy'
          ? await api.shopBuy({ shopId, itemId: id, qty: amount })
          : await api.shopSell({ shopId, uid: id, qty: amount });
      setShop(result.shopView);
      setView(result.view);
      setQty((current) => ({ ...current, [key]: 1 }));
      toast(
        result.stonesDelta < 0
          ? `付出灵石 ${Math.abs(result.stonesDelta).toLocaleString('zh-CN')}`
          : `得灵石 ${result.stonesDelta.toLocaleString('zh-CN')}`,
        'gain',
      );
      onTraded?.();
    } catch (error) {
      toast(errorMessage(error), 'warn');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const bag = view?.inventory ?? [];
  const sellable = shop
    ? bag.filter((row) => !row.equipped && shop.sellPrices[row.uid] !== undefined)
    : [];

  return (
    <Sheet open title={shop?.shop.name ?? '铺子'} onClose={onClose}>
      {!shop ? (
        <p className="empty">正在看货……</p>
      ) : (
        <div>
          <p className="shop__lede">{shop.shop.description}</p>
          <div className="shop__purse">
            <span className="shop__purse-label">灵石</span>
            <span className="shop__purse-value">{shop.spiritStones.toLocaleString('zh-CN')}</span>
          </div>

          <div className="segments" role="tablist" aria-label="买卖">
            {(
              [
                { id: 'buy' as const, label: '买入' },
                { id: 'sell' as const, label: '卖出' },
              ]
            ).map((entry) => (
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

          {tab === 'buy' && (
            <div className="shop__rows">
              {shop.entries.map((entry) => {
                const amount = qty[entry.itemId] ?? 1;
                const cap = Math.max(1, Math.min(entry.stockLeft ?? 99, 99));
                return (
                  <div
                    className={`shop-row ${entry.available ? '' : 'shop-row--blocked'}`}
                    key={entry.itemId}
                  >
                    <span className="shop-row__art">
                      <ArtImage
                        id={ITEM_BY_ID.get(entry.itemId)?.art ?? null}
                        label=""
                        motif="token"
                      />
                    </span>
                    <span className="shop-row__body">
                      <span className="shop-row__name">{entry.itemName}</span>
                      <span
                        className={`shop-row__note ${entry.blockedReason ? 'shop-row__note--gate' : ''}`}
                      >
                        {entry.blockedReason ??
                          (entry.stockLeft === null ? '货源充足' : `今日尚余 ${entry.stockLeft}`)}
                      </span>
                    </span>
                    <span className="shop-row__price">
                      ◇{(entry.price * amount).toLocaleString('zh-CN')}
                    </span>
                    <span className="stepper">
                      <button
                        type="button"
                        className="stepper__btn"
                        aria-label={`${entry.itemName}减一`}
                        disabled={busy || !entry.available || amount <= 1}
                        onClick={() => step(entry.itemId, -1, cap)}
                      >
                        −
                      </button>
                      <span className="stepper__value">{amount}</span>
                      <button
                        type="button"
                        className="stepper__btn"
                        aria-label={`${entry.itemName}加一`}
                        disabled={busy || !entry.available || amount >= cap}
                        onClick={() => step(entry.itemId, 1, cap)}
                      >
                        ＋
                      </button>
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy || !entry.available}
                      onClick={() => void trade('buy', entry.itemId, entry.itemId, amount)}
                    >
                      买
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'sell' && (
            <div className="shop__rows">
              {sellable.map((row) => {
                const item = ITEM_BY_ID.get(row.itemId);
                const unit = shop.sellPrices[row.uid] ?? 0;
                const amount = Math.min(qty[row.uid] ?? 1, row.qty);
                return (
                  <div className="shop-row" key={row.uid}>
                    <span className="shop-row__art">
                      <ArtImage id={item?.art ?? null} label="" motif="token" />
                    </span>
                    <span className="shop-row__body">
                      <span className="shop-row__name">{item?.name ?? row.itemId}</span>
                      {/* The money column already reads the unit price at 1. */}
                      <span className="shop-row__note">持有 {row.qty} 件</span>
                    </span>
                    <span className="shop-row__price">
                      ◇{(unit * amount).toLocaleString('zh-CN')}
                    </span>
                    <span className="stepper">
                      <button
                        type="button"
                        className="stepper__btn"
                        aria-label={`${item?.name ?? row.itemId}减一`}
                        disabled={busy || amount <= 1}
                        onClick={() => step(row.uid, -1, row.qty)}
                      >
                        −
                      </button>
                      <span className="stepper__value">{amount}</span>
                      <button
                        type="button"
                        className="stepper__btn"
                        aria-label={`${item?.name ?? row.itemId}加一`}
                        disabled={busy || amount >= row.qty}
                        onClick={() => step(row.uid, 1, row.qty)}
                      >
                        ＋
                      </button>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void trade('sell', row.uid, row.uid, amount)}
                    >
                      卖
                    </Button>
                  </div>
                );
              })}
              {sellable.length === 0 && <p className="empty">这家不收你行囊里的东西。</p>}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
