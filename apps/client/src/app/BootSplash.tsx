import { GAME_NAME, GAME_TAGLINE } from '../config';
import './boot.css';

/** Shown for the one round-trip it takes to validate a stored token. */
export function BootSplash() {
  return (
    <div className="boot">
      <div className="boot__mark ink-display" aria-hidden="true">
        {GAME_NAME}
      </div>
      <p className="boot__note">{GAME_TAGLINE}</p>
    </div>
  );
}
