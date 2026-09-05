import { useEffect, useState, useRef } from 'react';
import { ModalCard, modalButtonStyles } from '../LayerSystem/LayerSystem';
import styles from './EditMessageDialog.module.css';

interface EditMessageDialogProps {
  open: boolean;
  initialText: string;
  onClose: () => void;
  onConfirm: (newText: string) => void;
}

export function EditMessageDialog({ open, initialText, onClose, onConfirm }: EditMessageDialogProps) {
  const [text, setText] = useState(initialText);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    // Each opening starts from the message currently selected by the parent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(initialText);
  }, [initialText, open]);

  const handleConfirm = () => {
    onConfirm(text);
    onClose();
  };

  return (
    <ModalCard
      open={open}
      title="编辑消息"
      onClose={onClose}
      initialFocusRef={inputRef}
      actions={(
        <>
          <button type="button" className={modalButtonStyles.secondary} onClick={onClose}>取消</button>
          <button type="button" className={modalButtonStyles.primary} onClick={handleConfirm} disabled={!text.trim()}>发送</button>
        </>
      )}
    >
      <form onSubmit={(event) => { event.preventDefault(); handleConfirm(); }}>
        <label className={styles.label} htmlFor="edit-message-text">编辑您的消息</label>
        <textarea
          id="edit-message-text"
          ref={inputRef}
          className={styles.textarea}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
        />
      </form>
    </ModalCard>
  );
}
