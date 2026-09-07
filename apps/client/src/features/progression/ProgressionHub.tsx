import { Link } from 'react-router';
import { useCharacterStore } from '../../store/character';
import './progression.css';

export function ProgressionHub() {
  const p = useCharacterStore((s) => s.view?.character.progression);
  return (
    <section className="pg-home" aria-label="洞府养成">
      <div className="pg-home__head">
        <strong>洞府 · 仙途百艺</strong>
        <small>仙玉 {p?.materials.jade ?? 0}</small>
      </div>
      <nav aria-label="养成入口">
        <Link to="/treasures">
          本命法宝<small>{p?.starterClaimed ? '炼宝御敌' : '入门礼待领'}</small>
        </Link>
        <Link to="/relics">
          古宝图鉴<small>收藏即生效</small>
        </Link>
        <Link to="/gacha">
          寻宝阁<small>双池每日免费</small>
        </Link>
        <Link to="/daily">
          仙途日课<small>赚仙玉材料</small>
        </Link>
      </nav>
    </section>
  );
}
