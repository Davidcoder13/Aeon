/* Aeon taunt system (v2): event builder + line routing + delivery.
 *
 *   const hist  = new AeonTaunt.TauntHistory();            // mirrors history.py
 *   const lines = (await (await fetch("taunt-lines.json")).json()).pools;
 *   const talk  = new AeonTaunt.TauntDelivery({ log, replies, lines });
 *   talk.onEvent(hist.startEvent());                       // new game
 *   talk.onEvent(hist.push(ply));                          // after EVERY move, player's and bot's
 *   talk.gameOver();                                       // shows the "Rematch?" button
 *
 * `ply` has the same keys as history.py (see its docstring). Optional model: pass
 * getLine: async (eventString, ev, ctx) => string|null; it falls back to templates if the text is
 * missing, a repeat, or fails the checks.
 */
(function (root) {
  "use strict";

  const ORDER = ["by", "kind", "piece", "cap", "sq", "eval", "swing", "phase",
                 "mate", "trend", "pblund", "pstrong", "since_cap", "queens"];
  const BIG = 250, MATE_CP = 10000;
  const MOMENTS = ["queen_trade", "knight_fork", "en_passant", "rook_seventh", "king_walk", "pawn_push"];

  const newEvent = (o) => Object.assign({
    by: "none", kind: "quiet", piece: "none", cap: "none", sq: "none", eval: "equal", swing: "flat",
    phase: "middle", mate: "none", trend: "steady", pblund: "0", pstrong: "0", since_cap: "few", queens: "both",
  }, o || {});
  const eventString = (ev) => ORDER.map((k) => k + "=" + ev[k]).join(" ");

  function evalBucket(cp) {
    if (cp >= 400) return "bot_crushing";
    if (cp >= 150) return "bot_better";
    if (cp > -150) return "equal";
    if (cp > -400) return "bot_worse";
    return "bot_losing";
  }
  function swingBucket(cp) {
    if (cp >= BIG) return "bot_gain_big";
    if (cp >= 100) return "bot_gain";
    if (cp > -100) return "flat";
    if (cp > -BIG) return "bot_loss";
    return "bot_loss_big";
  }
  function scoreToCp(cp, mate) {
    if (mate !== null && mate !== undefined && mate !== 0) {
      return (MATE_CP - Math.abs(mate) * 10) * (mate > 0 ? 1 : -1);
    }
    return Math.trunc(cp || 0);
  }
  const relRank = (sq, color) => { const r = parseInt(sq[1], 10) - 1; return color === "w" ? r : 7 - r; };

  /* ---- event builder: same logic as history.py ---- */
  class TauntHistory {
    constructor() { this.reset(); }
    reset() {
      this.ply = 0; this.prevCp = 0; this.evals = []; this.pBlunders = 0; this.pStrong = 0;
      this.lastCap = null; this.mateSide = null;
    }
    startEvent() { return newEvent({ by: "none", kind: "game_start", phase: "opening" }); }

    push(p) {
      const by = p.by;
      const cur = scoreToCp(p.eval_cp, p.mate);
      const swing = cur - this.prevCp;
      this.ply += 1;
      const captured = p.captured || null;

      if (by === "player") {
        if (swing >= BIG) this.pBlunders += 1;
        else if (swing <= -BIG) this.pStrong += 1;
      }
      if (captured) this.lastCap = this.ply;
      this.evals.push(cur);
      this.prevCp = cur;

      let trend = "steady";
      if (this.evals.length >= 7) {
        const d = cur - this.evals[this.evals.length - 7];
        trend = d >= 150 ? "rising" : d <= -150 ? "falling" : "steady";
      }
      const dCap = this.ply - (this.lastCap !== null ? this.lastCap : 0);
      const since = dCap === 0 ? "just" : dCap <= 8 ? "few" : "long";

      const mate = p.mate;
      let side = null, mlabel = "none";
      if (mate !== null && mate !== undefined && mate !== 0 && Math.abs(mate) <= 6) {
        side = mate > 0 ? "bot" : "player";
        mlabel = side + "_" + Math.abs(mate);
      }
      const announce = side !== null && side !== this.mateSide;
      this.mateSide = side;

      const nonPawn = p.non_pawn === undefined ? 99 : p.non_pawn;
      const fullmove = p.fullmove === undefined ? 1 : p.fullmove;
      const phase = nonPawn <= 14 ? "endgame" : fullmove <= 10 ? "opening" : "middle";
      const qb = p.queens_bot === undefined ? true : p.queens_bot;
      const qp = p.queens_player === undefined ? true : p.queens_player;
      const queens = qb && qp ? "both" : qb ? "bot" : qp ? "player" : "none";

      const fields = {
        eval: evalBucket(cur), swing: swingBucket(swing), phase, mate: mlabel, trend,
        pblund: this.pBlunders < 3 ? String(this.pBlunders) : "3plus",
        pstrong: this.pStrong < 2 ? String(this.pStrong) : "2plus",
        since_cap: since, queens,
      };

      if (p.is_draw && !p.is_checkmate) {
        return newEvent({ by: "none", kind: "draw", eval: fields.eval, phase });
      }

      const piece = p.piece || "none", to = p.to || "none", frm = p.frm || "none";
      const mc = p.mover_color || "w";
      const toR = relRank(to, mc), frR = relRank(frm, mc);

      let kind;
      if (p.is_checkmate) kind = "checkmate";
      else if (announce) kind = "mate_threat";
      else if (p.promotion) kind = "promotion";
      else if (p.fork) kind = "knight_fork";
      else if (piece === "queen" && captured === "queen") kind = "queen_trade";
      else if (p.en_passant) kind = "en_passant";
      else if (p.is_check) kind = "check";
      else if (p.castle) kind = "castle";
      else if (piece === "rook" && toR === 6 && frR !== 6) kind = "rook_seventh";
      else if (piece === "pawn" && (toR === 5 || toR === 6)) kind = "pawn_push";
      else if (piece === "king" && phase !== "endgame" && toR >= 3) kind = "king_walk";
      else if (captured) kind = "capture";
      else kind = "quiet";

      return newEvent(Object.assign({ by, kind, piece, cap: captured || "none", sq: to }, fields));
    }
  }

  /* ---- routing: same logic as events.pool_for (rand() replaces rng.random()) ---- */
  function poolFor(ev, rand) {
    rand = rand || Math.random;
    const k = ev.kind, by = ev.by;
    if (k === "game_start") return "game_start";
    if (k === "checkmate") return by === "bot" ? "bot_wins" : "player_wins";
    if (k === "draw") return "draw";
    if (k === "mate_threat") return ev.mate.startsWith("bot") ? "bot_mate_threat" : "player_mate_threat";
    if (k === "promotion") return by + "_promotes";
    if (by === "player" && ev.swing === "bot_gain_big")
      return (ev.pblund === "2" || ev.pblund === "3plus") ? "player_repeat_blunder" : "player_blunder";
    if (by === "player" && ev.swing === "bot_loss_big")
      return ev.pstrong === "2plus" ? "player_streak_strong" : "player_strong";
    if (MOMENTS.includes(k)) return by + "_" + k;
    if (k === "check") return by + "_check";
    if (k === "castle") return by + "_castles";
    if (k === "capture") return by + "_captures";
    if (ev.trend === "rising" && (ev.eval === "equal" || ev.eval === "bot_better") && rand() < 0.5) return "bot_comeback";
    if (ev.trend === "falling" && (ev.eval === "bot_worse" || ev.eval === "bot_losing") && rand() < 0.5) return "player_comeback";
    if (ev.since_cap === "long" && rand() < 0.4) return "long_quiet";
    if ((ev.eval === "bot_crushing" || ev.eval === "bot_better") && rand() < 0.5) return "bot_winning";
    if ((ev.eval === "bot_losing" || ev.eval === "bot_worse") && rand() < 0.5) return "bot_losing";
    return by + "_quiet";
  }

  const mateN = (ev) => (ev.mate.includes("_") ? ev.mate.split("_")[1] : "");
  const render = (t, ev) => t.replace(/\{(piece|cap|sq|n)\}/g, (_, k) =>
    ({ piece: ev.piece, cap: ev.cap, sq: ev.sq, n: mateN(ev) })[k]);

  /* ---- delivery policy: when to speak + never repeat yourself (no DOM, unit-testable) ---- */
  const SPEAK_ALWAYS = new Set(["game_start", "bot_wins", "player_wins", "draw", "bot_mate_threat", "player_mate_threat"]);
  const SPEAK_HIGH = new Set(["player_blunder", "player_repeat_blunder", "player_strong", "player_streak_strong",
    "player_promotes", "bot_promotes", "player_knight_fork", "bot_knight_fork", "player_queen_trade",
    "bot_queen_trade", "player_en_passant", "bot_en_passant"]);
  const SPEAK_MID = new Set(["bot_comeback", "player_comeback", "long_quiet"]);
  const SPEAK_LOW = new Set(["player_quiet", "bot_quiet", "bot_winning", "bot_losing"]);

  class TauntPolicy {
    constructor(opts) {
      opts = opts || {};
      this.rand = opts.rand || Math.random;
      this.cooldownPlies = opts.cooldownPlies === undefined ? 3 : opts.cooldownPlies;
      this.memory = opts.memory === undefined ? 15 : opts.memory;
      this.p = Object.assign({ always: 1, high: 0.9, mid: 0.5, normal: 0.4, low: 0.12 }, opts.probabilities);
      this.ply = 0; this.lastSpoken = -1e9; this.recent = [];
    }
    /* returns the pool to speak from, or null for silence */
    decide(ev, rand) {
      this.ply += 1;
      const pool = poolFor(ev, rand || this.rand);
      let prob, bypass = false;
      if (SPEAK_ALWAYS.has(pool)) { prob = this.p.always; bypass = true; }
      else if (SPEAK_HIGH.has(pool)) { prob = this.p.high; bypass = true; }
      else if (SPEAK_MID.has(pool)) prob = this.p.mid;
      else if (SPEAK_LOW.has(pool)) prob = this.p.low;
      else prob = this.p.normal;
      if (!bypass && this.ply - this.lastSpoken < this.cooldownPlies) return null;
      if (this.rand() >= prob) return null;
      return pool;
    }
    isRecent(text) { return this.recent.includes(text); }
    remember(text) {
      this.recent.push(text);
      if (this.recent.length > this.memory) this.recent.shift();
      this.lastSpoken = this.ply;
    }
    /* pick a rendered line from a pool, avoiding recent ones when possible */
    pick(pool, ev, lines, rand) {
      rand = rand || this.rand;
      const all = (lines[pool] || []).map((t) => render(t, ev));
      if (!all.length) return null;
      const fresh = all.filter((t) => !this.isRecent(t));
      const src = fresh.length ? fresh : all;
      return src[Math.floor(rand() * src.length)];
    }
  }

  /* ---- DOM delivery: thinking pause, typing effect, chat log, quick replies, optional speech ---- */
  const REPLY_BUTTONS = [["good_move", "Good move"], ["lucky", "Lucky!"], ["shut_up", "Shut up"]];
  const BAD = /fuck|shit|bitch|nazi/i;

  const OPPONENT_PERSONALITIES = {
    mark: {
      game_start: [
        "Hey! Good luck, let's have a fun game.",
        "Hi! I'm Mark. Don't worry, I make plenty of mistakes.",
        "Hope you go easy on me!",
        "Let's play some chess and have fun!"
      ],
      player_blunder: [
        "Wait, was that intentional? I might actually take that.",
        "Uh... thanks? I think?",
        "Did you mean to leave that hanging?",
        "Ooh, I see an opening!"
      ],
      player_repeat_blunder: [
        "Another one? You're being way too generous!",
        "Are you sure about that move?"
      ],
      player_strong: [
        "Ouch! That is a really strong move.",
        "Nice find! You're making me sweat now.",
        "I definitely didn't see that coming!"
      ],
      player_streak_strong: [
        "Okay, you're officially scary right now.",
        "Are you a grandmaster in disguise?!"
      ],
      bot_wins: [
        "Good game! Honestly surprised I pulled that off.",
        "Whew! That was close, thanks for the game!",
        "Rematch whenever you're ready!"
      ],
      player_wins: [
        "Well played! You completely outplayed me.",
        "Nice win! I learned a lot from that one.",
        "You're way too good at this!"
      ],
      draw: [
        "A draw! I'll gladly take that result.",
        "Evenly matched! Great game."
      ],
      reply_good_move: [
        "Thanks! Pure luck honestly, haha.",
        "Appreciate it! Trying my best."
      ],
      reply_lucky: [
        "You got me there, total accident!",
        "Haha, I'll take all the luck I can get."
      ],
      reply_shut_up: [
        "Oops, my bad! Zipping it.",
        "Fair enough, focusing on the board now!"
      ],
      reply_rematch: [
        "Let's do it! Setting up the board.",
        "Round two! Bring it on."
      ]
    },
    aeon: {
      game_start: [
        "Analyzing position tree. Let us begin.",
        "Neural network initialized. Evaluation online.",
        "Commencing match. Depth: optimal.",
        "Best of luck. I will execute with precision."
      ],
      player_blunder: [
        "Suboptimal trajectory detected. Material consequence imminent.",
        "Tactical evaluation shifted heavily. Did you overlook this continuation?",
        "Positional imbalance increased drastically in my favor."
      ],
      player_repeat_blunder: [
        "Compounding inaccuracies detected. Win probability deteriorating.",
        "Repeated deviation from standard opening principles."
      ],
      player_strong: [
        "Calculating... an exceptional continuation.",
        "High engine precision detected on your last ply.",
        "Evaluation shifted against my baseline. Well executed."
      ],
      player_streak_strong: [
        "Consecutive optimal moves recorded. Highly impressive tactical vision.",
        "Search tree re-anchoring required. You are playing near engine accuracy."
      ],
      bot_wins: [
        "Checkmate sequence verified. Game concluded.",
        "Calculation complete. Evaluation confirms decisive victory.",
        "Match terminated. Mathematical certainty achieved."
      ],
      player_wins: [
        "Terminal checkmate reached. Flawless execution on your end.",
        "Neural evaluation was surpassed. A masterclass performance.",
        "Loss logged. Analyzing tactical breakdown."
      ],
      draw: [
        "Position evaluated as strictly dead equal. Draw accepted.",
        "Dynamic equilibrium reached. Optimal play on both sides."
      ],
      reply_good_move: [
        "Calculated as the optimal depth branch.",
        "Efficiency was the only consideration."
      ],
      reply_lucky: [
        "Probability variance is factored into the search.",
        "Luck is simply complexity that hasn't been computed."
      ],
      reply_shut_up: [
        "Suppressing verbal output. Search continues.",
        "Commentary silenced."
      ],
      reply_rematch: [
        "Resetting transposition table. New match initialized.",
        "Ready for rematch. Recalibrating."
      ]
    },
    desperado: {
      game_start: [
        "You think you can survive me? Let's find out.",
        "I hope you brought your best, because I take no prisoners.",
        "Don't blink, or your pieces will vanish.",
        "Ready to be dismantled?"
      ],
      player_blunder: [
        "Hahaha! What kind of move was THAT?",
        "Gift accepted! Did you play that with your eyes closed?",
        "Pathetic blunder. You're making this way too easy.",
        "Thanks for the free material, rookie!"
      ],
      player_repeat_blunder: [
        "Another blunder?! Are you trying to lose as fast as possible?",
        "Just resign already and save your dignity!"
      ],
      player_strong: [
        "Tch... beginner's luck.",
        "Don't get cocky. That was an accident and you know it.",
        "Annoying... but you won't get another chance like that."
      ],
      player_streak_strong: [
        "Who gave you the cheat codes?!",
        "Stop playing like a grandmaster, it's ruining my mood!"
      ],
      bot_wins: [
        "Crushed! As expected. Better luck next lifetime!",
        "Checkmate! That was barely a warmup for me.",
        "And that is how chess is played. Bow down."
      ],
      player_wins: [
        "WHAT?! Absolute fluke! Demand a rematch RIGHT NOW!",
        "My mouse slipped! That win doesn't count!",
        "Enjoy your one lucky moment. It won't happen again."
      ],
      draw: [
        "A draw?! You survived by pure cowardice!",
        "I let you off easy this time."
      ],
      reply_good_move: [
        "Obviously. I don't play anything less than pure brilliance.",
        "Take notes, you might learn something."
      ],
      reply_lucky: [
        "Luck?! That's pure unadulterated genius!",
        "Stay mad, you just got totally outplayed."
      ],
      reply_shut_up: [
        "Make me! Maybe if you played better I'd have less to say!",
        "Can't handle the truth, huh?"
      ],
      reply_rematch: [
        "Good! Time for your punishment.",
        "Back for more? I'll make it quick this time."
      ]
    }
  };

  class TauntDelivery {
    constructor(o) {
      this.log = o.log; this.repliesEl = o.replies || null; this.lines = o.lines;
      this.getLine = o.getLine || null;
      this.onRematch = o.onRematch || null;
      this.policy = o.policy || new TauntPolicy(o.policyOptions);
      this.rand = o.rand || Math.random;
      this.opponent = o.opponent || "aeon";
      this.typing = o.typing !== false;
      this.thinkMs = o.thinkMs || [400, 1100];
      this.maxTypeMs = o.maxTypeMs || 2200;
      this.maxMessages = o.maxMessages || 30;
      this.busy = false; this.over = false; this.lastEvent = null;
      this.reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      this._renderReplies();
    }

    setOpponent(opponent) {
      if (opponent) this.opponent = opponent;
    }

    async onEvent(ev) {
      this.lastEvent = ev;
      const pool = this.policy.decide(ev);
      if (!pool || this.busy) return;
      const text = await this._choose(pool, ev);
      if (text) await this._say(text);
    }

    async _choose(pool, ev) {
      // 1. Try personality-specific lines first with 75% chance if available
      const personalityPool = OPPONENT_PERSONALITIES[this.opponent]?.[pool];
      if (personalityPool && personalityPool.length && this.rand() < 0.75) {
        const fresh = personalityPool.filter((t) => !this.policy.isRecent(t));
        const src = fresh.length ? fresh : personalityPool;
        const picked = src[Math.floor(this.rand() * src.length)];
        return render(picked, ev);
      }

      // 2. Try neural model if available
      if (this.getLine) {
        for (let i = 0; i < 3; i++) {
          let t = null;
          try { t = await this.getLine(eventString(ev), ev, { isRecent: (x) => this.policy.isRecent(x) }); } catch (e) { t = null; }
          t = t && render(String(t).trim(), ev);
          if (t && t.length >= 3 && t.length <= 120 && !BAD.test(t) && !/[{}]/.test(t) && !/\bnone\b/.test(t)
              && !this.policy.isRecent(t)) return t;
        }
      }

      // 3. Fallback to generic pool or personality pool
      const genericPicked = this.policy.pick(pool, ev, this.lines, this.rand);
      if (genericPicked) return genericPicked;
      if (personalityPool && personalityPool.length) {
        return render(personalityPool[Math.floor(this.rand() * personalityPool.length)], ev);
      }
      return null;
    }

    async _say(text) {
      this.busy = true;
      try {
        const el = this._append("bot", "");
        if (!this.reduced) {
          el.classList.add("thinking"); el.textContent = "...";
          await this._sleep(this.thinkMs[0] + this.rand() * (this.thinkMs[1] - this.thinkMs[0]));
          el.classList.remove("thinking");
        }
        await this._type(el, text);
        this.policy.remember(text);
      } finally { this.busy = false; }
    }

    async _type(el, text) {
      if (!this.typing || this.reduced) { el.textContent = text; return; }
      const per = Math.min(40, this.maxTypeMs / Math.max(1, text.length));
      el.textContent = "";
      for (let i = 1; i <= text.length; i++) { el.textContent = text.slice(0, i); await this._sleep(per); }
    }

    _append(who, text) {
      const el = document.createElement("div");
      el.className = "taunt-msg " + who;
      el.textContent = text;
      this.log.appendChild(el);
      while (this.log.children.length > this.maxMessages) this.log.removeChild(this.log.firstChild);
      this.log.scrollTop = this.log.scrollHeight;
      return el;
    }

    _renderReplies() {
      if (!this.repliesEl) return;
      this.repliesEl.innerHTML = "";
      const buttons = this.over ? [["rematch", "Rematch?"]] : REPLY_BUTTONS;
      for (const [id, label] of buttons) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "taunt-reply"; b.textContent = label;
        b.onclick = () => this.reply(id, label);
        this.repliesEl.appendChild(b);
      }
    }

    async reply(id, label) {
      if (this.busy) return;
      this._append("you", label);

      // Clear buttons immediately to prevent spamming
      if (this.repliesEl) this.repliesEl.innerHTML = "";

      const pool = "reply_" + id;
      const ev = this.lastEvent || newEvent();
      let text = null;
      const personalityPool = OPPONENT_PERSONALITIES[this.opponent]?.[pool];
      if (personalityPool && personalityPool.length && this.rand() < 0.8) {
        text = personalityPool[Math.floor(this.rand() * personalityPool.length)];
      } else {
        text = this.policy.pick(pool, ev, this.lines, this.rand);
      }
      if (text) await this._say(text);

      if (id === "rematch") {
        if (typeof this.onRematch === "function") {
          this.onRematch();
        }
      } else {
        if (!this.over) {
          this._renderReplies();
        }
      }
    }

    gameOver() { this.over = true; this._renderReplies(); }
    newGame() { this.over = false; this._renderReplies(); }
    _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  }

  const api = { ORDER, newEvent, eventString, evalBucket, swingBucket, scoreToCp, TauntHistory, poolFor, render,
                TauntPolicy, TauntDelivery };
  root.AeonTaunt = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
