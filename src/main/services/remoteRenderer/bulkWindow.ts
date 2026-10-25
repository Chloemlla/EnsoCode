/**
 * 远程桌面大帧的发送窗口：浏览器回报已收字节，宿主只让一个窗口的未确认数据在路上。
 *
 * 桌面上行可能只有几百 KB/s，一次把 MB 级分片全写进 socket 会堆在系统 TCP 缓冲里（bufferedAmount 看不到），
 * 心跳 ping 排在后面超时、中继被判死重连，在途数据全丢再补发，越补越慢。
 * 旧版浏览器不回报，收到第一次 ack 之前不限流。
 */
export class BulkWindow<T> {
  private enabled = false;
  private inflight = 0;
  private acked = 0;
  private queue: { item: T; bytes: number }[] = [];
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowBytes: number;
  private readonly stallMs: number;

  constructor(
    private readonly send: (item: T) => void,
    options: { windowBytes?: number; stallMs?: number } = {}
  ) {
    this.windowBytes = options.windowBytes ?? 512 * 1024;
    this.stallMs = options.stallMs ?? 15_000;
  }

  push(item: T, bytes: number): void {
    if (!this.enabled) {
      this.send(item);
      return;
    }
    this.queue.push({ item, bytes });
    this.pump();
  }

  /** bytes：浏览器本页累计收到的分片字节；比上次小说明换了新页面 */
  ack(bytes: number): void {
    this.enabled = true;
    const delta = bytes >= this.acked ? bytes - this.acked : bytes;
    this.acked = bytes;
    this.inflight = Math.max(0, this.inflight - delta);
    this.clearStall();
    this.pump();
  }

  /** 链路断开：已排队的不再发（续上后宿主按 seq 补发，资源由浏览器重新请求） */
  reset(): void {
    this.queue = [];
    this.inflight = 0;
    this.clearStall();
  }

  private pump(): void {
    while (this.queue.length > 0 && this.inflight < this.windowBytes) {
      const next = this.queue.shift() as { item: T; bytes: number };
      this.inflight += next.bytes;
      this.send(next.item);
    }
    if (this.queue.length > 0 && !this.stallTimer) {
      // ack 丢了也别永远卡住：一段时间没回报就当已送达
      this.stallTimer = setTimeout(() => {
        this.stallTimer = null;
        this.inflight = 0;
        this.pump();
      }, this.stallMs);
    }
  }

  private clearStall(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }
}
