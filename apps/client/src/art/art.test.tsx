import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ArtManifest } from '@xianxia/shared';
import { useArtStore } from '../store/art';
import { ArtImage } from './ArtImage';

const MANIFEST: ArtManifest = {
  version: 1,
  generatedAt: '2026-09-05T00:00:00Z',
  assets: {
    'bg/cultivation-day': {
      src: '/art/bg/cultivation-day.webp',
      srcSmall: '/art/bg/cultivation-day@720.webp',
      w: 1080,
      h: 1920,
      alpha: false,
    },
  },
};

afterEach(() => {
  useArtStore.setState({ manifest: null, status: 'idle', enabled: true });
});

describe('ArtImage', () => {
  it('draws a labelled placeholder when the manifest has not loaded', () => {
    render(<ArtImage id="bg/login" label="孤峰远影" motif="scene" />);
    expect(screen.getByRole('img', { name: '孤峰远影（图稿待补）' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '孤峰远影' })).not.toBeInTheDocument();
  });

  it('falls back to a placeholder for an id the manifest does not carry', () => {
    useArtStore.setState({ manifest: MANIFEST, status: 'ready' });
    render(<ArtImage id="boss/kunlun-heaven-beast" label="昆仑天兽" motif="beast" />);
    expect(screen.getByRole('img', { name: '昆仑天兽（图稿待补）' })).toBeInTheDocument();
  });

  it('uses the bitmap once the manifest carries it', () => {
    useArtStore.setState({ manifest: MANIFEST, status: 'ready' });
    render(<ArtImage id="bg/cultivation-day" label="云海山巅" motif="scene" />);
    const image = screen.getByRole('img', { name: '云海山巅' });
    expect(image).toHaveAttribute('src', '/art/bg/cultivation-day.webp');
  });

  it('prefers the 720px variant for backgrounds when asked', () => {
    useArtStore.setState({ manifest: MANIFEST, status: 'ready' });
    render(<ArtImage id="bg/cultivation-day" label="云海山巅" motif="scene" small />);
    expect(screen.getByRole('img', { name: '云海山巅' })).toHaveAttribute(
      'src',
      '/art/bg/cultivation-day@720.webp',
    );
  });

  it('honours the ?art=off development switch', () => {
    useArtStore.setState({ manifest: MANIFEST, status: 'ready', enabled: false });
    render(<ArtImage id="bg/cultivation-day" label="云海山巅" motif="scene" />);
    expect(screen.getByRole('img', { name: '云海山巅（图稿待补）' })).toBeInTheDocument();
  });
});
