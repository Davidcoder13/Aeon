export class TauntModelClient {
  constructor() {
    this.nextId = 0;
    this.pending = new Map();
    this.ready = false;
    this.failed = false;
    this.worker = new Worker(new URL("./taunt-model-worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        this.ready = true;
        return;
      }
      if (data.type === "init-error") {
        this.failed = true;
        this.resolveAll(null);
        console.warn("Aeon taunt model unavailable; using templates:", data.message);
        return;
      }
      const pending = this.pending.get(data.id);
      if (pending) pending.finish(data.line || null);
    };
    this.worker.onerror = (event) => {
      this.failed = true;
      this.resolveAll(null);
      console.warn("Aeon taunt model worker failed; using templates:", event.message);
    };
    this.worker.postMessage({ action: "init" });
  }

  getLine(event) {
    if (!this.ready || this.failed) return Promise.resolve(null);
    const id = ++this.nextId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.pending.get(id)?.finish(null), 12000);
      this.pending.set(id, { finish: (line) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(line);
      } });
      this.worker.postMessage({ id, action: "generate", event });
    });
  }

  resolveAll(line) {
    for (const pending of this.pending.values()) pending.finish(line);
  }
}
