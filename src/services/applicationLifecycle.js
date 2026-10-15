const TERMINAL_STAGES = new Set(["offer", "rejected"]);

export function applicationReminderTransition({
  application,
  status,
  nextFollowUpAt,
  reminderEnabled,
  archived = false,
}) {
  const currentDate = application?.nextFollowUpAt
    ? new Date(application.nextFollowUpAt).getTime()
    : null;
  const nextDate =
    nextFollowUpAt === undefined
      ? currentDate
      : nextFollowUpAt === null || nextFollowUpAt === ""
        ? null
        : new Date(nextFollowUpAt).getTime();
  const enabled =
    reminderEnabled === undefined
      ? Boolean(application?.reminderEnabled)
      : Boolean(reminderEnabled);
  const terminal = TERMINAL_STAGES.has(status || application?.status);
  const cancel = Boolean(
    archived ||
    terminal ||
    currentDate !== nextDate ||
    enabled !== Boolean(application?.reminderEnabled),
  );
  return {
    cancel,
    enabled: enabled && !terminal && !archived,
    schedule: !archived && !terminal && enabled && cancel && nextDate !== null,
    terminal,
  };
}
