import { useState, useRef } from 'react';
import AuthorPopup, { AuthorCard, useAnchorRect } from '@/components/AuthorPopup';
import type { CommitAuthor } from '@/types';

// ─── Author card with hover tooltip ──────────────────────────────────────────

export default function AuthorCardWithTooltip({ author, label }: { author: CommitAuthor; label: string }) {
  const [showPopup, setShowPopup] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const anchorRect = useAnchorRect(showPopup, anchorRef);

  return (
    <div
      ref={anchorRef}
      onMouseEnter={() => setShowPopup(true)}
      onMouseLeave={() => setShowPopup(false)}
    >
      <AuthorCard author={author} label={label} />
      {showPopup && anchorRect && <AuthorPopup author={author} anchorRect={anchorRect} />}
    </div>
  );
}
