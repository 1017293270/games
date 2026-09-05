import { useEffect, useState } from 'react';
import type { ArtId } from '@xianxia/shared';
import { ArtPlaceholder, type Motif } from './Placeholder';
import { useArt } from './useArt';

export interface ArtImageProps {
  id: ArtId | null | undefined;
  /** Shown to screen readers, and printed on the placeholder. '' hides the caption. */
  label: string;
  motif?: Motif;
  /** Prefer the 720px background variant when the manifest offers one. */
  small?: boolean;
  className?: string;
}

/** Cut-out assets sit on whatever is behind them, so their stand-ins must too. */
function isCutout(id: ArtId | null | undefined): boolean {
  return Boolean(id && (id.startsWith('char/') || id.startsWith('item/') || id.startsWith('ui/')));
}

/**
 * One picture slot. Draws the bitmap when the manifest has it and a placeholder
 * otherwise — including after a load error, so a half-published manifest still
 * leaves a readable screen.
 */
export function ArtImage({
  id,
  label,
  motif = 'scene',
  small = false,
  className = '',
}: ArtImageProps) {
  const entry = useArt(id);
  const [broken, setBroken] = useState(false);
  const src = entry ? (small && entry.srcSmall ? entry.srcSmall : entry.src) : null;

  useEffect(() => {
    setBroken(false);
  }, [src]);

  if (!src || broken) {
    return (
      <ArtPlaceholder
        label={label}
        motif={motif}
        seed={id ?? label}
        transparent={isCutout(id)}
        className={className}
      />
    );
  }

  return (
    <img
      className={`art ${className}`}
      src={src}
      alt={label}
      width={entry?.w}
      height={entry?.h}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}
