import type { TreasureForm } from '@xianxia/shared';

/** New progression art stays independent of the legacy manifest. */
export function progressionArtSource(definition: {
  id: string;
  form?: TreasureForm;
}): string | null {
  if (definition.form && ['tower', 'banner', 'shield'].includes(definition.form)) {
    return `/art/progression/treasure-${definition.form}-v1.webp`;
  }
  const relic = /^r-(?:spirit|immortal|saint|divine)-([0-5])$/.exec(definition.id);
  return relic ? `/art/progression/relic-${relic[1]}-v1.webp` : null;
}
