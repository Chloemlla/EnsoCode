/** 待投递完成通知的容量上限：防无界增长；溢出是显式、有日志的丢，与静默丢不同 */
export const REMINDER_QUEUE_LIMIT = 1000;

/** 入队；满了丢最旧的一条并返回 true */
export function enqueueReminder(
  queue: string[],
  text: string,
  limit = REMINDER_QUEUE_LIMIT
): boolean {
  queue.push(text);
  if (queue.length <= limit) return false;
  queue.splice(0, queue.length - limit);
  return true;
}
