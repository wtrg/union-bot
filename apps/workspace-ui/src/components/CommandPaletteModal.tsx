import React, { useState, useEffect, useRef } from 'react';

interface CommandItem {
  id: string;
  name: string;
  description: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  commands,
}) => {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = commands.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < filtered.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        className="command-palette"
        style={{
          width: 540,
          backgroundColor: 'var(--bg-secondary, #0f172a)',
          border: '1px solid var(--border-color, #334155)',
          borderRadius: 8,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-color, #334155)' }}>
          <span style={{ marginRight: 10, fontSize: 16, color: 'var(--text-muted, #94a3b8)' }}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or slash action (e.g. /work, /chat, /pause)..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary, #f8fafc)',
              fontSize: 14,
            }}
          />
          <kbd
            style={{
              padding: '2px 6px',
              backgroundColor: 'var(--bg-tertiary, #1e293b)',
              border: '1px solid var(--border-color, #334155)',
              borderRadius: 4,
              fontSize: 11,
              color: 'var(--text-muted, #94a3b8)',
            }}
          >
            ESC
          </kbd>
        </div>

        <div style={{ maxHeight: 320, overflowY: 'auto', padding: 8 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)', fontSize: 13 }}>
              No commands matching "{search}"
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <div
                key={cmd.id}
                onClick={() => {
                  cmd.action();
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: selectedIndex === idx ? 'var(--accent-blue, #2563eb)' : 'transparent',
                  color: selectedIndex === idx ? '#ffffff' : 'var(--text-primary, #f8fafc)',
                  cursor: 'pointer',
                  transition: 'background-color 0.1s ease',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{cmd.name}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: selectedIndex === idx ? 'rgba(255, 255, 255, 0.8)' : 'var(--text-muted, #94a3b8)',
                      marginTop: 2,
                    }}
                  >
                    {cmd.description}
                  </div>
                </div>
                {cmd.shortcut && (
                  <kbd
                    style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 4,
                      backgroundColor: selectedIndex === idx ? 'rgba(0, 0, 0, 0.2)' : 'var(--bg-tertiary, #1e293b)',
                      color: selectedIndex === idx ? '#ffffff' : 'var(--text-muted, #94a3b8)',
                      border: '1px solid var(--border-color, #334155)',
                    }}
                  >
                    {cmd.shortcut}
                  </kbd>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
