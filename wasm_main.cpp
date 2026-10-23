// Small browser-facing API around Aeon's existing move generator, search and NNUE.
// The page calls this from a Web Worker; the browser UI never blocks while Aeon searches.
#include <algorithm>
#include <atomic>
#include <sstream>
#include <string>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define AEON_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define AEON_EXPORT
#endif

#include "bitboards.h"
#include "movegen.h"
#include "nnue.h"
#include "search.h"

namespace {
TranspositionTable g_tt(16);
SearchOptions g_options;
std::atomic<bool> g_stop{false};
SearchWorker g_worker(g_tt, g_stop, g_options, 0);
std::atomic<U64> g_node_slot[1];
std::string g_result;
bool g_initialized = false;

bool parse_moves(const char* moves, Position& pos, std::vector<U64>& history, std::string& error) {
    history.clear();
    history.push_back(pos.key);
    std::istringstream input(moves ? moves : "");
    std::string token;
    while (input >> token) {
        MoveList legal;
        generate_legal(pos, legal);
        bool found = false;
        for (Move move : legal) {
            if (move.str() == token) {
                pos.make(move);
                history.push_back(pos.key);
                found = true;
                break;
            }
        }
        if (!found) {
            error = "illegal move in move list: " + token;
            return false;
        }
    }
    return true;
}

bool get_position(const char* moves, Position& pos, std::vector<U64>& history) {
    std::string error;
    if (!g_initialized) {
        g_result = "ERROR: engine did not initialize";
        return false;
    }
    if (!parse_moves(moves, pos, history, error)) {
        g_result = "ERROR: " + error;
        return false;
    }
    return true;
}
}  // namespace

extern "C" {
AEON_EXPORT int aeon_init() {
    init_attacks();
    const std::string error = nnue_load("/best.bin");
    g_initialized = error.empty() && g_net.loaded;
    if (!g_initialized) {
        g_result = "ERROR: could not load /best.bin: " + error;
        return 0;
    }
    return 1;
}

// Returns three newline-separated fields: current FEN, legal UCI moves, and game status.
AEON_EXPORT const char* aeon_state(const char* moves) {
    Position pos;
    std::vector<U64> history;
    if (!get_position(moves, pos, history)) return g_result.c_str();

    MoveList legal;
    generate_legal(pos, legal);
    g_result = pos.fen() + "\n";
    for (int i = 0; i < legal.count; ++i) {
        if (i) g_result += ' ';
        g_result += legal.moves[i].str();
    }
    g_result += '\n';
    g_result += legal.count ? "playing" : (pos.in_check() ? "checkmate" : "stalemate");
    return g_result.c_str();
}

AEON_EXPORT const char* aeon_search(const char* moves, int movetime_ms) {
    Position pos;
    std::vector<U64> history;
    if (!get_position(moves, pos, history)) return g_result.c_str();

    SearchLimits limits;
    const int64_t base = std::max(100, movetime_ms);
    limits.soft_ms = base;
    limits.hard_ms = base * 2;
    g_stop.store(false, std::memory_order_relaxed);
    g_node_slot[0].store(0, std::memory_order_relaxed);
    const Move best = g_worker.iterate(pos, limits, history, Clock::now(), g_node_slot, 1, false);
    g_result = best.is_none() ? "" : best.str();
    return g_result.c_str();
}

AEON_EXPORT void aeon_new_game() {
    g_tt.clear();
    g_worker.new_game();
}
}  // extern "C"

int main() { return aeon_init() ? 0 : 1; }
