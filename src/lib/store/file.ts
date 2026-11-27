import { promises as fs } from "fs";
import path from "path";
import { pickEntries, type ListOptions, type Store } from "./index";

type Data = Record<string, Record<string, unknown>>;

/** JSON file store for local development only. Not safe for several server instances. */
export class FileStore implements Store {
  private file = path.join(process.cwd(), ".data", "store.json");
  private queue: Promise<unknown> = Promise.resolve();

  private async read(): Promise<Data> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as Data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw e;
    }
  }

  private async write(data: Data): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, this.file);
  }

  /** Run one read-modify-write at a time so concurrent requests do not lose updates. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  get<T>(collection: string, id: string): Promise<T | null> {
    return this.serial(async () => ((await this.read())[collection]?.[id] as T | undefined) ?? null);
  }

  put<T>(collection: string, id: string, doc: T): Promise<void> {
    return this.serial(async () => {
      const data = await this.read();
      (data[collection] ??= {})[id] = doc;
      await this.write(data);
    });
  }

  delete(collection: string, id: string): Promise<void> {
    return this.serial(async () => {
      const data = await this.read();
      if (data[collection]) delete data[collection][id];
      await this.write(data);
    });
  }

  take<T>(collection: string, id: string): Promise<T | null> {
    return this.serial(async () => {
      const data = await this.read();
      const doc = (data[collection]?.[id] as T | undefined) ?? null;
      if (doc !== null) {
        delete data[collection][id];
        await this.write(data);
      }
      return doc;
    });
  }

  update<T, R>(collection: string, id: string, fn: (cur: T | null) => { doc: T | null; result: R }): Promise<R> {
    return this.serial(async () => {
      const data = await this.read();
      const { doc, result } = fn((data[collection]?.[id] as T | undefined) ?? null);
      if (doc === null) delete (data[collection] ??= {})[id];
      else (data[collection] ??= {})[id] = doc;
      await this.write(data);
      return result;
    });
  }

  list<T>(collection: string, opts?: ListOptions): Promise<T[]> {
    return this.serial(async () => pickEntries<T>(Object.entries((await this.read())[collection] ?? {}), opts));
  }
}
