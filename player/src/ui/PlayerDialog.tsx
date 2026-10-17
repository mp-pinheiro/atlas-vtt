import { useEffect, useId, useRef, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { CloseButton } from '../../../src/app/packages/components/primitives/CloseButton.tsx';
import { handledByAnotherControl } from '../../../src/app/keyboard/tooltipEscape.ts';
import { playerText } from '../i18n.ts';

export interface PlayerDialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

export function PlayerDialog({ title, onClose, children, className = '' }: PlayerDialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    const previous = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('.atlas-player__dialog-body')?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const backdrop = (event: MouseEvent<HTMLDialogElement>): void => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  };
  return <dialog ref={ref} className={`atlas-player__dialog ${className}`} role="dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={backdrop} onKeyDown={(event): void => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && !handledByAnotherControl(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }}>
    <div className="atlas-player__dialog-frame">
      <header className="atlas-player__dialog-header">
        <h2 id={titleId}>{title}</h2>
        <CloseButton aria-label={playerText('close')} onClick={onClose} />
      </header>
      <div className="atlas-player__dialog-body" tabIndex={-1}>{children}</div>
    </div>
  </dialog>;
}
