import { useEffect, useRef } from 'react';

const GROUPS = [
  {
    label: 'Sport',
    emojis: ['🏐', '💪', '🔥', '🏆', '🥇', '🎯', '⛹️', '🏃', '🧢', '👟', '🏟️', '⏱️'],
  },
  {
    label: 'Faccine',
    emojis: ['😀', '😄', '😁', '😅', '😂', '🙂', '😉', '😊', '😍', '🤩', '😎', '🤔', '😐', '😴', '🥲', '😭', '😤', '😱', '🤯', '🤗'],
  },
  {
    label: 'Gesti',
    emojis: ['👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '👊', '🙏', '🤙', '💪', '🫡'],
  },
  {
    label: 'Varie',
    emojis: ['❤️', '💙', '💚', '💛', '⭐', '✨', '🎉', '🍕', '🍻', '☕', '📍', '📅', '✅', '❌', '⚡', '🌊', '🌞', '🌧️'],
  },
];

export function EmojiPicker({ onPick, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose?.();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className="emoji-panel" ref={ref}>
      {GROUPS.map((group) => (
        <div key={group.label} className="emoji-group">
          <span className="emoji-label">{group.label}</span>
          <div className="emoji-grid">
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-item"
                onClick={() => onPick(emoji)}
                aria-label={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
