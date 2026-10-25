/**
 * 距判定「卡住」还要等多久，0 表示已卡住。
 * 中继下行可能只有几百 KB/s，大帧要传十几秒；只要还在收数据就不算丢，
 * 否则补发/重新 hello 会让宿主把同一批帧再排一遍队，越补越慢。
 */
export function stallDelay(now: number, windowMs: number, ...activity: number[]): number {
  return Math.max(0, Math.max(...activity) + windowMs - now);
}
