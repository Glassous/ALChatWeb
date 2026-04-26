import { useState, useEffect, useRef } from 'react';
import '@material/web/dialog/dialog.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/text-button.js';

interface EditMessageDialogProps {
  open: boolean;
  initialText: string;
  onClose: () => void;
  onConfirm: (newText: string) => void;
}

export function EditMessageDialog({ open, initialText, onClose, onConfirm }: EditMessageDialogProps) {
  const [text, setText] = useState(initialText);
  const dialogRef = useRef<any>(null);

  useEffect(() => {
    if (open) {
      setText(initialText);
      dialogRef.current?.show();
    } else {
      dialogRef.current?.close();
    }
  }, [open, initialText]);

  const handleConfirm = () => {
    onConfirm(text);
    onClose();
  };

  return (
    <md-dialog
      ref={dialogRef}
      onClose={onClose}
      style={{ minWidth: '320px', maxWidth: '560px', width: '90vw' }}
    >
      <div slot="headline">编辑消息</div>
      <form slot="content" method="dialog" id="edit-form" onSubmit={(e) => { e.preventDefault(); handleConfirm(); }}>
        <md-outlined-text-field
          label="编辑您的消息"
          type="textarea"
          value={text}
          onInput={(e: any) => setText(e.target.value)}
          rows={5}
          style={{ width: '100%' }}
          autofocus
        ></md-outlined-text-field>
      </form>
      <div slot="actions">
        <md-text-button onClick={onClose}>取消</md-text-button>
        <md-filled-button onClick={handleConfirm}>发送</md-filled-button>
      </div>
    </md-dialog>
  );
}
