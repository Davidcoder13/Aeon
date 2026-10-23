import * as ort from "./vendor/onnxruntime-web/ort.wasm.min.mjs";

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL("./vendor/onnxruntime-web/", import.meta.url).href;

const MODEL_URL = new URL("./taunt-model/taunt_int8.onnx", import.meta.url).href;
const VOCAB_URL = new URL("./taunt-model/vocab.json", import.meta.url).href;
const MAX_NEW = 140;
const TEMPERATURE = 0.7;
const TOP_K = 20;
let session = null;
let vocab = null;
let initPromise = null;

async function initialize() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const response = await fetch(VOCAB_URL);
    if (!response.ok) throw new Error(`taunt vocab returned ${response.status}`);
    vocab = await response.json();
    if (!Array.isArray(vocab.itos) || !vocab.known_words || !vocab.blocked_words) {
      throw new Error("taunt vocab is missing validation metadata");
    }
    session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    });
    return true;
  })();
  return initPromise;
}

function parseEvent(eventString) {
  return Object.fromEntries(eventString.split(/\s+/).map((field) => {
    const at = field.indexOf("=");
    return at < 0 ? ["", ""] : [field.slice(0, at), field.slice(at + 1)];
  }).filter(([key]) => key));
}

function validRaw(raw, eventString) {
  const text = raw.trim();
  if (text.length < 3 || text.length > 120 || !/^[\x20-\x7e]+$/.test(text)) return false;
  const lower = text.toLowerCase();
  if (vocab.blocked_words.some((word) => lower.includes(word))) return false;

  const ev = parseEvent(eventString);
  const placeholders = [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  const capAllowed = ev.kind === "capture"
    && !(ev.by === "player" && ["bot_gain_big", "bot_loss_big"].includes(ev.swing));
  const allowed = ev.kind === "mate_threat" ? new Set(["n"])
    : ["game_start", "promotion", "checkmate", "draw"].includes(ev.kind) ? new Set()
    : new Set(capAllowed ? ["piece", "sq", "cap"] : ["piece", "sq"]);
  if (placeholders.some((name) => !allowed.has(name))) return false;
  if (placeholders.includes("piece") && (!ev.piece || ev.piece === "none")) return false;
  if (placeholders.includes("sq") && (!ev.sq || ev.sq === "none")) return false;
  if (placeholders.includes("cap") && (!ev.cap || ev.cap === "none")) return false;
  if (placeholders.includes("n") && !/_\d+$/.test(ev.mate || "")) return false;
  if (text.replace(/\{\w+\}/g, "").match(/[{}]/)) return false;

  const words = text.replace(/\{\w+\}/g, " ").toLowerCase().match(/[a-z']+/g) || [];
  const known = new Set(vocab.known_words);
  return words.every((word) => known.has(word));
}

function sampleToken(logits, vocabSize) {
  const ranked = [];
  for (let id = 1; id < vocabSize; id++) {
    const value = logits[id] / TEMPERATURE;
    let i = ranked.length;
    while (i > 0 && ranked[i - 1].value < value) i--;
    ranked.splice(i, 0, { id, value });
    if (ranked.length > TOP_K) ranked.pop();
  }
  if (!ranked.length) return 0;
  const max = ranked[0].value;
  const weights = ranked.map(({ value }) => Math.exp(value - max));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let pick = Math.random() * total;
  for (let i = 0; i < ranked.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return ranked[i].id;
  }
  return ranked[ranked.length - 1].id;
}

async function generate(eventString) {
  await initialize();
  const stoi = new Map(vocab.itos.slice(1).map((char, index) => [char, index + 1]));
  const prompt = [...(eventString + "\t")].map((char) => stoi.get(char)).filter((id) => id !== undefined);
  if (!prompt.length || prompt.length >= vocab.block_size) return null;
  const stopId = stoi.get("\n");
  if (stopId === undefined) return null;

  const ids = [...prompt];
  let raw = "";
  for (let step = 0; step < MAX_NEW; step++) {
    const context = ids.slice(-vocab.block_size);
    const input = new ort.Tensor("int64", BigInt64Array.from(context, (id) => BigInt(id)), [1, context.length]);
    const output = await session.run({ input_ids: input });
    const logits = output.logits.data;
    const vocabSize = vocab.itos.length;
    const offset = (context.length - 1) * vocabSize;
    const next = sampleToken(logits.subarray(offset, offset + vocabSize), vocabSize);
    if (!next) return null;
    ids.push(next);
    if (next === stopId) break;
    raw += vocab.itos[next];
  }
  return validRaw(raw, eventString) ? raw.trim() : null;
}

self.onmessage = async ({ data }) => {
  const { id, action, event } = data || {};
  try {
    if (action === "init") {
      await initialize();
      self.postMessage({ type: "ready" });
    } else if (action === "generate") {
      self.postMessage({ id, line: await generate(event) });
    }
  } catch (error) {
    if (action === "init") self.postMessage({ type: "init-error", message: String(error) });
    else self.postMessage({ id, line: null, error: String(error) });
  }
};
