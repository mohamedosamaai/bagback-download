import React from 'react';
import { TFunction } from '../../lib/translations';
import { CloseIcon } from './Icons';

interface InfoModalProps {
  title: string;
  body: string;
  onClose: () => void;
  t: TFunction;
}

export function InfoModal({ title, body, onClose, t }: InfoModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('closeModal')}>
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">
          {body.split('\n').map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('closeModal')}
          </button>
        </div>
      </div>
    </div>
  );
}
export default InfoModal;
