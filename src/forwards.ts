import { autobind } from "core-decorators";

@autobind
export class Forwards {
  private turn: number = 0;
  private accepting: boolean = false;
  private readonly queue: {
    turn: number;
    delegateEmit: () => boolean;
    resolve: (handled: boolean) => void;
  }[] = [];

  public begin(): void {
    this.accepting = true;
  }

  public enqueue(delegateEmit: () => boolean): Promise<boolean> {
    if(!this.accepting) {
      return Promise.resolve(false);
    }
    const {turn} = this;
    return new Promise<boolean>((resolve) => {
      this.queue.push({turn, delegateEmit, resolve});
    });
  }

  public flush(): void {
    const curr = this.turn;
    this.turn++;
    const records = this.queue.slice();
    this.queue.length = 0;
    for(const {turn, delegateEmit, resolve} of records) {
      resolve(turn === curr ? delegateEmit() : false);
    }
  }

  public end(): void {
    this.accepting = false;
    const leftovers = this.queue.slice();
    this.queue.length = 0;
    for(const {resolve} of leftovers) {
      resolve(false);
    }
  }
}