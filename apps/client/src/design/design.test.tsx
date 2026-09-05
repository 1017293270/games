import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUiStore } from '../store/ui';
import { Button } from './Button';
import { InkFrame } from './InkFrame';
import { Modal, Sheet } from './Modal';
import { Overlay } from './Overlay';
import { ProgressBar } from './ProgressBar';

describe('Button', () => {
  it('defaults to a non-submitting button so it is safe inside forms', () => {
    render(<Button>入山门</Button>);
    expect(screen.getByRole('button', { name: '入山门' })).toHaveAttribute('type', 'button');
  });

  it('carries its variant and size as classes', () => {
    render(
      <Button variant="seal" size="sm" block>
        破境
      </Button>,
    );
    const button = screen.getByRole('button', { name: '破境' });
    expect(button.className).toContain('btn--seal');
    expect(button.className).toContain('btn--sm');
    expect(button.className).toContain('btn--block');
  });
});

describe('ProgressBar', () => {
  it('clamps out-of-range values', () => {
    const { rerender } = render(<ProgressBar value={2} label="修为" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<ProgressBar value={-1} label="修为" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    rerender(<ProgressBar value={Number.NaN} label="修为" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('Modal and Sheet', () => {
  it('renders nothing while closed', () => {
    render(
      <InkFrame>
        <Modal open={false} title="运功破境">
          <p>正文</p>
        </Modal>
      </InkFrame>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('portals into the ink frame overlay layer when open', () => {
    const { container } = render(
      <InkFrame>
        <Modal open title="运功破境">
          <p>正文</p>
        </Modal>
      </InkFrame>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(container.querySelector('.overlay-root')?.contains(dialog)).toBe(true);
  });

  it('closes on a scrim click but not on a click inside', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <InkFrame>
        <Modal open title="运功破境" onClose={onClose}>
          <p>正文</p>
        </Modal>
      </InkFrame>,
    );

    await user.click(screen.getByText('正文'));
    expect(onClose).not.toHaveBeenCalled();

    const scrim = container.querySelector('.scrim');
    expect(scrim).not.toBeNull();
    if (scrim) await user.click(scrim);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('lets a blocking modal ignore the scrim', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <InkFrame>
        <Modal open title="天劫" onClose={onClose} dismissable={false}>
          <p>正文</p>
        </Modal>
      </InkFrame>,
    );
    const scrim = container.querySelector('.scrim');
    if (scrim) await user.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes a sheet on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <InkFrame>
        <Sheet open title="丹房" onClose={onClose}>
          <p>正文</p>
        </Sheet>
      </InkFrame>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Overlay', () => {
  beforeEach(() => {
    useUiStore.setState({ overlayDepth: 0 });
  });

  it('counts the layers stacked over the page while they are mounted', () => {
    const { unmount } = render(
      <InkFrame>
        <Modal open title="运功破境">
          <p>正文</p>
        </Modal>
        <Sheet open title="丹房" onClose={() => {}}>
          <p>正文</p>
        </Sheet>
      </InkFrame>,
    );
    expect(useUiStore.getState().overlayDepth).toBe(2);
    unmount();
    expect(useUiStore.getState().overlayDepth).toBe(0);
  });

  it('leaves the count alone for a layer that reports rather than interrupts', () => {
    render(
      <InkFrame>
        <Overlay blocking={false}>
          <p>有人向你论道</p>
        </Overlay>
      </InkFrame>,
    );
    expect(screen.getByText('有人向你论道')).toBeInTheDocument();
    expect(useUiStore.getState().overlayDepth).toBe(0);
  });
});
