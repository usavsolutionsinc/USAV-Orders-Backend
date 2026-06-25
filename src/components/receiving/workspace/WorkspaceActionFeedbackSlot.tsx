'use client';

/**
 * Single-slot feedback below the label preview — same position as receive
 * complete. Item-description saves, Zoho notes saves, etc. mount here instead
 * of inline under their editors.
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  framerPresence,
  framerTransition,
} from '@/design-system/foundations/motion-framer';
import {
  useMotionPresence,
  useMotionTransition,
} from '@/design-system/foundations/motion-framer-hooks';
import {
  InlineActionFeedbackCard,
  type InlineActionFeedbackPayload,
} from './InlineActionFeedbackCard';

export function WorkspaceActionFeedbackSlot({
  feedback,
  onDismiss,
}: {
  feedback: InlineActionFeedbackPayload | null;
  onDismiss: () => void;
}) {
  const presence = useMotionPresence(framerPresence.workbenchPane);
  const transition = useMotionTransition(framerTransition.workbenchPaneMount);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {feedback ? (
        <motion.div
          key={feedback.at}
          initial={presence.initial}
          animate={presence.animate}
          exit={presence.exit}
          transition={transition}
        >
          <InlineActionFeedbackCard
            tone={feedback.tone}
            headline={feedback.headline}
            items={feedback.items}
            note={feedback.note}
            at={feedback.at}
            onDismiss={onDismiss}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
