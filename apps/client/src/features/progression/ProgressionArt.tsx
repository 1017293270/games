import { useState } from 'react';
import type { RelicDefinition, TreasureDefinition } from '@xianxia/shared';
import { ArtImage } from '../../art/ArtImage';
import { progressionArtSource } from './art';

export function ProgressionArt({
  definition,
}: {
  definition: TreasureDefinition | RelicDefinition;
}) {
  const source = progressionArtSource(definition);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!source || failedSource === source)
    return <ArtImage id={definition.art} label="" motif="token" />;
  return (
    <img
      src={source}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedSource(source)}
    />
  );
}
