import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { RELICS, TREASURES } from '@xianxia/shared';
import { progressionArtSource } from './art';
import { ProgressionArt } from './ProgressionArt';

describe('progression artwork', () => {
  it('maps relic objects and three treasure forms to their dedicated illustrations', () => {
    for (const relic of RELICS)
      expect(progressionArtSource(relic)).toBe(
        `/art/progression/relic-${relic.id.split('-').at(-1)}-v1.webp`,
      );
    for (const treasure of TREASURES)
      expect(progressionArtSource(treasure)).toBe(
        ['tower', 'banner', 'shield'].includes(treasure.form)
          ? `/art/progression/treasure-${treasure.form}-v1.webp`
          : null,
      );
  });
  it('falls back to the existing art component when a new illustration cannot load', () => {
    const { container } = render(<ProgressionArt definition={RELICS[0]!} />);
    const image = container.querySelector('img')!;
    expect(image).toHaveAttribute('src', '/art/progression/relic-0-v1.webp');
    fireEvent.error(image);
    expect(container.querySelector('img[src="/art/progression/relic-0-v1.webp"]')).toBeNull();
    expect(container.childElementCount).toBeGreaterThan(0);
  });
});
