export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly maxItems: number) {}

  push(item: T) {
    this.items.push(item);
    if (this.items.length > this.maxItems) {
      this.items = this.items.slice(-this.maxItems);
    }
  }

  values() {
    return this.items;
  }

  get length() {
    return this.items.length;
  }

  resize(maxItems: number) {
    this.items = this.items.slice(-Math.max(1, maxItems));
  }

  clear() {
    this.items = [];
  }
}
