import { beforeEach, describe, expect, it } from 'vitest';
import { getStage, stageName, type CharacterView } from '@xianxia/shared';
import { buildView, getWorld } from '../api/mock';
import { useCharacterStore } from './character';

function demoView(): CharacterView {
  const world = getWorld();
  const character = world.characters.get('char-demo');
  if (!character) throw new Error('demo character missing');
  return buildView(world, character);
}

beforeEach(() => {
  useCharacterStore.getState().reset();
});

describe('character store', () => {
  it('stamps the capture time so progress can be interpolated', () => {
    const before = Date.now();
    useCharacterStore.getState().setView(demoView());
    expect(useCharacterStore.getState().viewAt).toBeGreaterThanOrEqual(before);
  });

  it('merges an incremental character:update patch', () => {
    const view = demoView();
    useCharacterStore.getState().setView(view);

    useCharacterStore.getState().applyPatch({
      id: view.character.id,
      exp: 12_345,
      stageIndex: 12,
      powerScore: 99_999,
      stageName: stageName(12),
    });

    const next = useCharacterStore.getState().view;
    expect(next?.character.exp).toBe(12_345);
    expect(next?.character.stageIndex).toBe(12);
    expect(next?.character.powerScore).toBe(99_999);
    expect(next?.stageName).toBe(getStage(12).name);
    // Untouched fields survive the patch.
    expect(next?.character.name).toBe(view.character.name);
    expect(next?.inventory).toHaveLength(view.inventory.length);
  });

  it('ignores a patch addressed to somebody else', () => {
    const view = demoView();
    useCharacterStore.getState().setView(view);
    useCharacterStore.getState().applyPatch({ id: 'char-someone-else', exp: 1 });
    expect(useCharacterStore.getState().view?.character.exp).toBe(view.character.exp);
  });

  it('drops everything on reset', () => {
    useCharacterStore.getState().setView(demoView());
    useCharacterStore.getState().reset();
    expect(useCharacterStore.getState().view).toBeNull();
  });
});
