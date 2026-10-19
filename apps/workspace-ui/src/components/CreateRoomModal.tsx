import React, { useState } from 'react';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateRoom: (id: string, name: string) => Promise<boolean>;
}

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({
  isOpen,
  onClose,
  onCreateRoom,
}) => {
  const [roomName, setRoomName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = roomName.trim();
    if (!cleanName) return;

    const cleanId = cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const ok = await onCreateRoom(cleanId, cleanName);
      if (ok) {
        setRoomName('');
        onClose();
      } else {
        setErrorMessage('Failed to create room. It may already exist.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error creating room');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          width: 420,
          maxWidth: '90vw',
          padding: 20,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        <h3 style={{ margin: '0 0 12px 0', fontSize: 16, color: 'var(--text-primary)' }}>
          Create New Collaboration Room (P3-003)
        </h3>
        <p style={{ margin: '0 0 16px 0', fontSize: 12, color: 'var(--text-muted)' }}>
          Rooms persist durable message histories in SQLite WAL.
        </p>

        {errorMessage && (
          <div style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 12 }}>
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
            Room Name
          </label>
          <input
            type="text"
            placeholder="e.g. feature-export, release-qa"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            autoFocus
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              fontSize: 14,
              marginBottom: 16,
              outline: 'none',
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 14px',
                borderRadius: 4,
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !roomName.trim()}
              style={{
                padding: '6px 16px',
                borderRadius: 4,
                border: 'none',
                background: 'var(--accent-blue)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isSubmitting ? 'Creating...' : 'Create Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
