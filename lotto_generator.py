"""
LottoIQ - Numbers, driven by Numbers
=====================================
Config-driven lottery number generator supporting:
  - Standard draws (6 or 7 numbers from a pool)
  - Pick 3 / Pick 4 (digit-based)
  - Keno-style (many picks from a large pool)
  - Bonus number format
  - User-supplied CSV data OR pure probability fallback

Built-in games use local CSV files.
Custom games can be added via CSV upload or pure probability.
"""

import random
import csv
import json
import os
from collections import defaultdict, Counter
from datetime import datetime


# ── Game Registry ──────────────────────────────────────────────────────────────
# Each game is defined by a config dict.
# format: "standard" | "pick" | "keno"
# picks:  how many numbers the user selects
# pool:   highest number in the pool (1 to pool, or 0-9 for pick)
# has_bonus: whether a bonus number is drawn
# csv:    filename of historical data (None = pure probability)

BUILTIN_GAMES = {
    "1": {
        "name":      "Lotto 6/49",
        "format":    "standard",
        "picks":     6,
        "pool":      49,
        "has_bonus": True,
        "csv":       "lotto649_history.csv",
        "region":    "Canada (National)",
    },
    "2": {
        "name":      "Lotto MAX",
        "format":    "standard",
        "picks":     7,
        "pool":      52,
        "has_bonus": True,
        "csv":       "lottomax_history.csv",
        "region":    "Canada (National)",
    },
    "3": {
        "name":      "Lottario",
        "format":    "standard",
        "picks":     6,
        "pool":      45,
        "has_bonus": True,
        "csv":       "lottario_full_history.csv",
        "region":    "Ontario",
    },
    "4": {
        "name":      "Ontario 49",
        "format":    "standard",
        "picks":     6,
        "pool":      49,
        "has_bonus": True,
        "csv":       "ontario49_history.csv",
        "region":    "Ontario",
    },
}

CUSTOM_GAMES_FILE = "custom_games.json"


# ── Custom Game Registry ───────────────────────────────────────────────────────

def load_custom_games(script_dir):
    """Load user-added custom games from JSON file."""
    path = os.path.join(script_dir, CUSTOM_GAMES_FILE)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_custom_games(custom_games, script_dir):
    """Save custom games registry to JSON file."""
    path = os.path.join(script_dir, CUSTOM_GAMES_FILE)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(custom_games, f, indent=2)


def get_all_games(script_dir):
    """Return combined builtin + custom games dict."""
    custom = load_custom_games(script_dir)
    return BUILTIN_GAMES, custom


# ── Favorites ─────────────────────────────────────────────────────────────────

FAVORITES_FILE = "favorites.json"

def load_favorites(script_dir):
    """Load saved favorite numbers per game key."""
    path = os.path.join(script_dir, FAVORITES_FILE)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_favorites(favorites, script_dir):
    """Save favorite numbers to JSON file."""
    path = os.path.join(script_dir, FAVORITES_FILE)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(favorites, f, indent=2)

def ask_favorites(game_key, game, script_dir):
    """
    Ask user about favorite numbers for this game.
    Supports use, change, delete, and skip.
    Returns list of up to 2 locked favorite numbers (or empty list).
    """
    if game["format"] == "pick":
        return []  # Not applicable for digit games

    picks   = game["picks"]
    pool    = game["pool"]
    name    = game["name"]
    max_fav = 2

    favorites = load_favorites(script_dir)
    saved     = favorites.get(game_key, [])

    print()
    print("=" * 55)
    print(f"  Favorite Numbers — {name}")
    print("=" * 55)

    if saved:
        print(f"\n  Saved favorites: {', '.join(str(n) for n in saved)}")
        print(f"  [1] Use saved favorites")
        print(f"  [2] Change favorites")
        print(f"  [3] Delete favorites")
        print(f"  [4] Skip favorites this session")
        print()
        while True:
            c = input("  Enter 1, 2, 3, or 4: ").strip()
            if c in ("1","2","3","4"):
                break
            print("  Please enter 1, 2, 3, or 4.")

        if c == "1":
            print(f"  Locking in: {', '.join(str(n) for n in saved)}")
            return saved
        elif c == "3":
            del favorites[game_key]
            save_favorites(favorites, script_dir)
            print(f"  Favorites deleted for {name}.")
            return []
        elif c == "4":
            return []
        # c == "2": fall through to entry below

    else:
        print(f"\n  No saved favorites for {name}.")
        print(f"  [1] Add favorite numbers (up to {max_fav})")
        print(f"  [2] Skip")
        print()
        while True:
            c = input("  Enter 1 or 2: ").strip()
            if c in ("1","2"):
                break
            print("  Please enter 1 or 2.")
        if c == "2":
            return []

    # Enter / change favorites
    print(f"\n  Enter up to {max_fav} favorite numbers (1-{pool}).")
    print(f"  Press Enter with no number to finish.")
    new_favs = []
    while len(new_favs) < max_fav:
        raw = input(f"  Favorite {len(new_favs)+1}: ").strip()
        if raw == "":
            break
        if raw.isdigit() and 1 <= int(raw) <= pool:
            num = int(raw)
            if num not in new_favs:
                new_favs.append(num)
            else:
                print(f"  {num} already added.")
        else:
            print(f"  Please enter a number between 1 and {pool}.")

    if new_favs:
        favorites[game_key] = new_favs
        save_favorites(favorites, script_dir)
        print(f"  Saved! Locking in: {', '.join(str(n) for n in new_favs)}")
    else:
        # User pressed Enter immediately - clear favorites
        if game_key in favorites:
            del favorites[game_key]
            save_favorites(favorites, script_dir)
        print(f"  No favorites set.")
    return new_favs


def ask_overdue_picks(draws, game, locked_count):
    """
    Show top 10 overdue numbers and let user pick up to 2.
    locked_count = number of favorites already locked in.
    Returns list of chosen overdue numbers (or empty list).
    """
    if game["format"] == "pick" or not draws:
        return []

    picks    = game["picks"]
    pool     = game["pool"]
    max_over = min(2, picks - locked_count - 2)  # Always leave 2 for generator

    if max_over <= 0:
        print(f"\n  No slots available for overdue numbers")
        print(f"  (favorites already fill {locked_count} of {picks-2} available locked slots)")
        return []

    # Calculate overdue (reverse so index 0 = oldest, making last_seen indices correct)
    reversed_draws = list(reversed(draws))
    last_seen = {}
    for i, draw in enumerate(reversed_draws):
        for num in draw:
            last_seen[num] = i
    total   = len(reversed_draws)
    overdue = sorted(
        [(num, (total-1) - last_seen.get(num, -1)) for num in range(1, pool+1)],
        key=lambda x: x[1], reverse=True
    )

    print()
    print("=" * 55)
    print(f"  Overdue Numbers — {game['name']}")
    print("=" * 55)
    print(f"\n  Top 10 most overdue numbers (you can lock in up to {max_over}):")
    print()
    for rank, (num, ago) in enumerate(overdue[:10], 1):
        print(f"  [{rank:>2}]  {num:>2}  —  last drawn {ago} draws ago")

    print()
    print(f"  Enter up to {max_over} rank number(s) from the list above.")
    print(f"  Press Enter with no input to skip.")
    print()

    chosen = []
    while len(chosen) < max_over:
        raw = input(f"  Pick {len(chosen)+1} (rank 1-10 or Enter to skip): ").strip()
        if raw == "":
            break
        if raw.isdigit() and 1 <= int(raw) <= 10:
            rank   = int(raw) - 1
            num    = overdue[rank][0]
            ago    = overdue[rank][1]
            if num not in chosen:
                chosen.append(num)
                print(f"  Locked: {num}  (overdue {ago} draws)")
            else:
                print(f"  Already selected.")
        else:
            print(f"  Please enter a rank between 1 and 10.")

    return chosen


# ── CSV Loader ─────────────────────────────────────────────────────────────────

def load_csv(csv_path: str, picks: int, pool: int, fmt: str) -> list[tuple]:
    """
    Load historical draws from CSV.
    Handles standard (N1..Nn) and auto-detected column layouts.
    Returns list of sorted tuples of main numbers only.
    """
    draws = []
    if not os.path.exists(csv_path):
        return draws

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []

        # Detect number columns - look for N1, N2... or num_1, num_2... or just integers
        num_cols = [c for c in fieldnames if c.upper().startswith("N") and
                    c[1:].isdigit()]
        if not num_cols:
            # Fallback: try columns that contain mostly numeric data
            num_cols = [c for c in fieldnames
                       if c.lower() not in ("date", "draw_date", "bonus", "year")]

        for row in reader:
            try:
                if fmt == "pick":
                    # Pick games: digits 0-9
                    nums = [int(row[c]) for c in num_cols[:picks]]
                    if all(0 <= n <= 9 for n in nums):
                        draws.append(tuple(nums))  # Don't sort pick digits
                else:
                    nums = [int(row[c]) for c in num_cols[:picks]]
                    if all(1 <= n <= pool for n in nums):
                        draws.append(tuple(sorted(nums)))
            except (ValueError, KeyError):
                continue

    return draws


# ── Max Millions Loader ────────────────────────────────────────────────────────

MAX_MILLIONS_CSV = "maxMillions.csv"

def load_max_millions_csv(script_dir: str) -> list[tuple]:
    """
    Load Max Millions draws from its CSV.
    Date format is M/D/YYYY — normalised on load.
    Returns list of sorted 7-number tuples (no bonus column).
    """
    path = os.path.join(script_dir, MAX_MILLIONS_CSV)
    if not os.path.exists(path):
        return []

    draws = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        num_cols = [c for c in (reader.fieldnames or [])
                    if c.upper().startswith("N") and c[1:].isdigit()]
        for row in reader:
            try:
                nums = [int(row[c]) for c in num_cols[:7]]
                if all(1 <= n <= 52 for n in nums):
                    draws.append(tuple(sorted(nums)))
            except (ValueError, KeyError):
                continue
    return draws


def ask_lotto_max_source(script_dir: str, lotto_max_draws: list) -> tuple:
    """
    Ask user which Lotto MAX dataset source to use.
    Returns (draws, source_label) where draws is the combined/selected list.
    source_label is used to prefix the subsequent ask_dataset label.
    """
    print("\n  Loading Max Millions data...")
    mm_draws = load_max_millions_csv(script_dir)

    lm_count = len(lotto_max_draws)
    mm_count = len(mm_draws)
    combined = lotto_max_draws + mm_draws
    cb_count = len(combined)

    print()
    print("=" * 55)
    print("  Dataset Source — Lotto MAX")
    print("=" * 55)
    print(f"\n  Which draw pool would you like to analyse?")
    print(f"  [1] Lotto MAX only          ({lm_count:,} draws)")
    if mm_count:
        print(f"  [2] Max Millions only       ({mm_count:,} draws)")
        print(f"  [3] Lotto MAX + Max Millions ({cb_count:,} draws)")
    print()

    valid = ("1", "2", "3") if mm_count else ("1",)
    while True:
        c = input("  Enter choice: ").strip()
        if c in valid:
            break
        print(f"  Please enter {' or '.join(valid)}.")

    if c == "1":
        return lotto_max_draws, "Lotto MAX"
    if c == "2":
        return mm_draws, "Max Millions"
    return combined, "Lotto MAX + Max Millions"


# ── Dataset Selection ──────────────────────────────────────────────────────────

def ask_dataset(draws, game_name):
    """Ask which subset of draws to use. Returns (subset, label)."""
    total = len(draws)
    print()
    print("=" * 55)
    print(f"  Dataset — {game_name}")
    print("=" * 55)
    print(f"\n  Base your stats and picks on:")
    print(f"  [1] All historical draws  ({total:,} draws)")
    print(f"  [2] Last 90 draws         ({min(90, total)} draws)")
    print(f"  [3] Last 30 draws         ({min(30, total)} draws)")
    print(f"  [4] Pure probability      (no historical weighting)")
    print()

    while True:
        c = input("  Enter 1, 2, 3, or 4: ").strip()
        if c in ("1","2","3","4"):
            break
        print("  Please enter 1, 2, 3, or 4.")

    if c == "1": return draws,           f"All {total:,} draws"
    if c == "2": return draws[:90],      "Last 90 draws"
    if c == "3": return draws[:30],      "Last 30 draws"
    return None, "Pure probability"


# ── Frequency ─────────────────────────────────────────────────────────────────

def build_frequency(draws, pool, fmt):
    """Build frequency map from draws."""
    freq = defaultdict(int)
    lo   = 0 if fmt == "pick" else 1
    for draw in draws:
        for num in draw:
            freq[num] += 1
    return freq


def build_uniform_frequency(pool, fmt):
    """Equal weight for all numbers/digits."""
    lo = 0 if fmt == "pick" else 1
    return {n: 1 for n in range(lo, pool + 1)}


# ── Stats ──────────────────────────────────────────────────────────────────────

def ask_pair_picks(draws, game, locked_count):
    """
    Show top 10 most common pairs and let user pick one to lock in.
    locked_count = number of favorites + overdue already locked.
    Returns list of up to 2 numbers from the chosen pair (or empty list).
    """
    if game["format"] == "pick" or not draws:
        return []

    picks    = game["picks"]
    # A pair uses 2 slots — check we have room for at least 2 more for generator
    max_slots = picks - locked_count - 2
    if max_slots < 2:
        print(f"\n  No slots available for a common pair")
        print(f"  ({locked_count} numbers already locked, need 2 slots free for generator)")
        return []

    pairs = get_common_pairs(draws, 10)
    if not pairs:
        print("\n  No pair data available.")
        return []

    print()
    print("=" * 55)
    print(f"  Common Pairs — {game['name']}")
    print("=" * 55)
    print(f"\n  Top 10 most common pairs in dataset:")
    print(f"  (You can lock in 1 pair — both numbers will be included)")
    print()
    for rank, ((n1, n2), cnt) in enumerate(pairs, 1):
        n = len(draws)
        pct = cnt / n * 100
        print(f"  [{rank:>2}]  {n1:>2} & {n2:>2}  —  "
              f"appeared together {cnt} times ({pct:.1f}%)")

    print()
    print("  Enter the rank of the pair to lock in (or press Enter to skip):")
    print()

    while True:
        raw = input("  Pick a pair (1-10 or Enter to skip): ").strip()
        if raw == "":
            return []
        if raw.isdigit() and 1 <= int(raw) <= 10:
            rank    = int(raw) - 1
            n1, n2  = pairs[rank][0]
            cnt     = pairs[rank][1]
            print(f"  Locked pair: {n1} & {n2}  (appeared together {cnt} times)")
            return [n1, n2]
        print("  Please enter a rank between 1 and 10.")


def get_filter_ranges(draws):
    """Compute sum/spread filter ranges from active draws."""
    n       = len(draws)
    sums    = sorted([sum(d) for d in draws])
    spreads = [max(d) - min(d) for d in draws]
    return {
        "sum_min":      sums[0],
        "sum_max":      sums[-1],
        "sum_low_max":  sums[int(n * 0.33)],
        "sum_mid_min":  sums[int(n * 0.25)],
        "sum_mid_max":  sums[int(n * 0.75)],
        "sum_high_min": sums[int(n * 0.67)],
        "avg_sum":      sum(sums) / n,
        "avg_spread":   sum(spreads) / n,
    }


def get_overdue(draws, max_num):
    """Return list of (number, draws_since_last_seen) sorted most overdue first.
    Draws may be in newest-first order; reversed internally so index 0 = oldest."""
    reversed_draws = list(reversed(draws))
    last_seen = {}
    for i, draw in enumerate(reversed_draws):
        for num in draw:
            last_seen[num] = i
    total   = len(reversed_draws)
    overdue = [(num, (total-1) - last_seen.get(num, -1)) for num in range(1, max_num+1)]
    return sorted(overdue, key=lambda x: x[1], reverse=True)


def get_common_pairs(draws, n=10):
    """
    Count how often each pair of numbers appears together across draws.
    Returns top n pairs as ((num1, num2), count) tuples.
    """
    pair_counts = Counter()
    for draw in draws:
        nums = sorted(draw)
        for i in range(len(nums)):
            for j in range(i + 1, len(nums)):
                pair_counts[(nums[i], nums[j])] += 1
    return pair_counts.most_common(n)


def compute_due_scores(draws, pool, dataset_label=""):
    """
    Compute a composite 'Due Score' for each number in the pool using
    exponential decay weighting (i=0 = most recent draw).

    Requires minimum 20 draws; returns [] otherwise.

    Lambda is selected automatically based on draw count:
      n <= 30  → λ = 0.05
      n <= 90  → λ = 0.025
      else     → λ = 0.01

    Four signals, each normalised 0–25 pts:
      1. Decay-weighted frequency  — sum of weights where number appeared
      2. Trend tag                 — compare recent half vs older half
                                     ↑ Rising +25 / → Stable +12 / ↓ Cooling +0
      3. Recency / overdue        — same logic as get_overdue(), linear 0–25
      4. Cluster affinity          — decay-weighted co-occurrence with top-10
                                     decay-freq numbers, normalised 0–25

    Returns list of
      (number, total_score, trend_tag, freq_pts, trend_pts, overdue_pts, cluster_pts)
    sorted by total_score descending, or [] if < 20 draws.
    """
    import math

    n = len(draws)
    if n < 20:
        return []

    # ── Select lambda ─────────────────────────────────────────────────────────
    if n <= 30:
        lam = 0.05
    elif n <= 90:
        lam = 0.025
    else:
        lam = 0.01

    # Pre-compute weights for all draw positions (i=0 is most recent)
    weights = [math.exp(-lam * i) for i in range(n)]

    # ── Signal 1: Decay-weighted frequency ───────────────────────────────────
    decay_freq = defaultdict(float)
    for i, draw in enumerate(draws):
        w = weights[i]
        for num in draw:
            decay_freq[num] += w

    df_vals = [decay_freq.get(num, 0.0) for num in range(1, pool + 1)]
    df_min, df_max = min(df_vals), max(df_vals)
    df_range = df_max - df_min if df_max != df_min else 1.0
    freq_pts = {
        num: round((decay_freq.get(num, 0.0) - df_min) / df_range * 25)
        for num in range(1, pool + 1)
    }

    # ── Signal 2: Trend tag ───────────────────────────────────────────────────
    # Split draws in half; compare decay-weighted frequency in each half.
    # Weights are re-indexed within each half so i=0 is most recent in that half.
    half = n // 2
    recent_half = draws[:half]
    older_half  = draws[half:]

    decay_recent = defaultdict(float)
    for i, draw in enumerate(recent_half):
        w = math.exp(-lam * i)
        for num in draw:
            decay_recent[num] += w

    decay_older = defaultdict(float)
    for i, draw in enumerate(older_half):
        w = math.exp(-lam * i)
        for num in draw:
            decay_older[num] += w

    trend_tags = {}
    trend_pts  = {}
    for num in range(1, pool + 1):
        r = decay_recent.get(num, 0.0)
        o = decay_older.get(num, 0.0)
        if o == 0.0:
            ratio = 1.0 if r == 0.0 else 999.0
        else:
            ratio = r / o
        if ratio > 1.20:
            trend_tags[num] = "↑ Rising"
            trend_pts[num]  = 25
        elif ratio < 0.80:
            trend_tags[num] = "↓ Cooling"
            trend_pts[num]  = 0
        else:
            trend_tags[num] = "→ Stable"
            trend_pts[num]  = 12

    # ── Signal 3: Recency / Overdue ───────────────────────────────────────────
    overdue_list = get_overdue(draws, pool)   # sorted most-overdue first
    overdue_map  = {num: ago for num, ago in overdue_list}
    ago_vals     = list(overdue_map.values())
    o_min, o_max = min(ago_vals), max(ago_vals)
    o_range = o_max - o_min if o_max != o_min else 1.0
    overdue_pts = {
        num: round((overdue_map.get(num, 0) - o_min) / o_range * 25)
        for num in range(1, pool + 1)
    }

    # ── Signal 4: Cluster Affinity ────────────────────────────────────────────
    # Top-10 numbers by decay-weighted frequency across all draws
    top10_hot = {
        num for num, _ in
        sorted(decay_freq.items(), key=lambda x: x[1], reverse=True)[:10]
    }

    # Decay-weighted co-occurrence of each number with top-10 hot numbers
    co_score = defaultdict(float)
    for i, draw in enumerate(draws):
        w = weights[i]
        hot_in_draw = [num for num in draw if num in top10_hot]
        for num in draw:
            # Subtract 1 if num is itself a top-10 number (avoid self-count)
            co_score[num] += w * (len(hot_in_draw) - (1 if num in top10_hot else 0))

    co_vals = [co_score.get(num, 0.0) for num in range(1, pool + 1)]
    c_min, c_max = min(co_vals), max(co_vals)
    c_range = c_max - c_min if c_max != c_min else 1.0
    cluster_pts = {
        num: round((co_score.get(num, 0.0) - c_min) / c_range * 25)
        for num in range(1, pool + 1)
    }

    # ── Assemble results ──────────────────────────────────────────────────────
    results = []
    for num in range(1, pool + 1):
        fp = freq_pts[num]
        tp = trend_pts[num]
        op = overdue_pts[num]
        cp = cluster_pts[num]
        results.append((num, fp + tp + op + cp, trend_tags[num], fp, tp, op, cp))

    return sorted(results, key=lambda x: x[1], reverse=True)


def print_stats(draws, freq, game, dataset_label):
    """Print full stats for the active dataset."""
    n     = len(draws)
    picks = game["picks"]
    fmt   = game["format"]
    name  = game["name"]
    pool  = game["pool"]

    sorted_freq = sorted(freq.items(), key=lambda x: x[1], reverse=True)
    hot   = sorted_freq[:5]
    cold  = sorted(sorted_freq[-5:], key=lambda x: x[1])

    # Overdue (reverse so index 0 = oldest, making last_seen indices correct)
    reversed_draws = list(reversed(draws))
    last_seen = {}
    for i, draw in enumerate(reversed_draws):
        for num in draw:
            last_seen[num] = i
    lo = 0 if fmt == "pick" else 1
    overdue = sorted(
        [(num, (n-1) - last_seen.get(num, -1)) for num in range(lo, pool+1)],
        key=lambda x: x[1], reverse=True
    )

    print()
    print("=" * 55)
    print(f"  Stats — {name}")
    print(f"  Dataset: {dataset_label}  ({n:,} draws)")
    print("=" * 55)

    print(f"\n  TOP 10 most drawn numbers:")
    max_cnt = max(freq.values()) if freq else 1
    for num, cnt in sorted_freq[:10]:
        bar = "#" * int(cnt / max_cnt * 20)
        print(f"    {num:>2}  ({cnt:>4} times)  {bar}")

    print(f"\n  HOT  (most frequent in dataset):")
    for num, cnt in hot:
        print(f"    {num:>2}  appeared {cnt} times")

    print(f"\n  COLD (least frequent in dataset):")
    for num, cnt in cold:
        print(f"    {num:>2}  appeared {cnt} times")

    print(f"\n  OVERDUE (longest since last seen):")
    for num, ago in overdue[:5]:
        print(f"    {num:>2}  last drawn {ago} draws ago")

    if fmt != "pick":
        sums    = [sum(d) for d in draws]
        spreads = [max(d) - min(d) for d in draws]
        consec  = [sum(1 for i in range(len(d)-1) if d[i+1]-d[i]==1) for d in draws]
        oe      = Counter(f"{sum(1 for x in d if x%2!=0)}o/{picks-sum(1 for x in d if x%2!=0)}e"
                          for d in draws)

        print(f"\n  CONSECUTIVE PAIRS:")
        pct = sum(1 for c in consec if c > 0) / n * 100
        print(f"    At least one pair: {pct:.1f}% of draws")
        for k, cnt in sorted(Counter(consec).items()):
            print(f"    {k} pair(s): {cnt:>5} draws ({cnt/n*100:.1f}%)")

        print(f"\n  SPREAD:")
        print(f"    Avg: {sum(spreads)/n:.1f}  Min: {min(spreads)}  Max: {max(spreads)}")

        print(f"\n  SUM OF DRAW:")
        print(f"    Avg: {sum(sums)/n:.1f}  Min: {min(sums)}  Max: {max(sums)}")

        print(f"\n  ODD/EVEN SPLIT (top 5):")
        for combo, cnt in oe.most_common(5):
            print(f"    {combo}: {cnt:>5} draws ({cnt/n*100:.1f}%)")

        print(f"\n  MOST COMMON PAIRS (top 10):")
        pairs = get_common_pairs(draws, 10)
        for rank, ((n1, n2), cnt) in enumerate(pairs, 1):
            pct = cnt / n * 100
            print(f"    [{rank:>2}]  {n1:>2} & {n2:>2}  —  "
                  f"appeared together {cnt} times ({pct:.1f}%)")

        # ── Due Score ─────────────────────────────────────────────────────────
        print(f"\n  DUE SCORE — Top 10"
              f"  (decay-weighted: frequency trend + recency + cluster affinity)")
        print(f"  " + "-" * 55)
        due_scores = compute_due_scores(draws, pool, dataset_label)
        if not due_scores:
            print(f"    (Need at least 20 draws — only {n:,} available. Skipped.)")
        else:
            for rank, (num, total, tag, fp, tp, op, cp) in enumerate(due_scores[:10], 1):
                print(f"  [{rank:>2}]  {num:>2}  "
                      f"Score: {total:<4d} "
                      f"{tag:<10}  "
                      f"Freq+{fp:<2d}  Trend+{tp:<2d}  "
                      f"Overdue+{op:<2d}  Cluster+{cp:<2d}")

    print()
    print("-" * 55)


# ── Filters ────────────────────────────────────────────────────────────────────

def get_dataset_hints(draws, game, ranges):
    """
    Dynamically calculate which filter option is most common
    in the active dataset. Returns a dict of hint labels.
    """
    picks = game["picks"]
    pool  = game["pool"]
    third = pool // 3
    r     = ranges
    n     = len(draws)

    if n == 0 or game["format"] == "pick":
        return {}

    # ── Sum hint ──────────────────────────────────────────────────────────────
    sums = [sum(d) for d in draws]
    low_cnt  = sum(1 for s in sums if s <= r["sum_low_max"])
    mid_cnt  = sum(1 for s in sums if r["sum_mid_min"] <= s <= r["sum_mid_max"])
    high_cnt = sum(1 for s in sums if s >= r["sum_high_min"])
    sum_most = max(
        ("L", low_cnt),
        ("M", mid_cnt),
        ("H", high_cnt),
        key=lambda x: x[1]
    )[0]

    # ── Spread hint ───────────────────────────────────────────────────────────
    spreads = [max(d) - min(d) for d in draws]
    med_cnt  = sum(1 for s in spreads if 16 <= s <= 30)
    wide_cnt = sum(1 for s in spreads if s >= 31)
    spread_most = "W" if wide_cnt >= med_cnt else "M"

    # ── Odd/Even hint ─────────────────────────────────────────────────────────
    if picks == 6:
        bal_cnt  = sum(1 for d in draws if sum(1 for x in d if x%2!=0) == 3)
        odd_cnt  = sum(1 for d in draws if sum(1 for x in d if x%2!=0) in (4,5))
        even_cnt = sum(1 for d in draws if sum(1 for x in d if x%2!=0) in (1,2))
        oe_most  = max(("B",bal_cnt),("O",odd_cnt),("E",even_cnt), key=lambda x: x[1])[0]
    elif picks == 7:
        bal_cnt  = sum(1 for d in draws if sum(1 for x in d if x%2!=0) in (3,4))
        odd_cnt  = sum(1 for d in draws if sum(1 for x in d if x%2!=0) >= 5)
        even_cnt = sum(1 for d in draws if sum(1 for x in d if x%2!=0) <= 2)
        oe_most  = max(("B",bal_cnt),("O",odd_cnt),("E",even_cnt), key=lambda x: x[1])[0]
    else:
        half     = picks // 2
        bal_cnt  = sum(1 for d in draws if sum(1 for x in d if x%2!=0) == half)
        odd_cnt  = sum(1 for d in draws if sum(1 for x in d if x%2!=0) > half)
        oe_most  = "B" if bal_cnt >= odd_cnt else "O"

    # ── High/Low hint ─────────────────────────────────────────────────────────
    def zone(d):
        lo = sum(1 for x in d if x <= third)
        hi = sum(1 for x in d if x > third * 2)
        mi = picks - lo - hi
        return lo, mi, hi

    bal_cnt  = sum(1 for d in draws
                   if all(z > 0 for z in zone(d)) and
                   all(z <= picks//2 for z in zone(d)))
    low_hcnt = sum(1 for d in draws if zone(d)[0] > picks//2)
    high_hcnt= sum(1 for d in draws if zone(d)[2] > picks//2)
    hl_most  = max(("B",bal_cnt),("L",low_hcnt),("H",high_hcnt), key=lambda x: x[1])[0]

    return {
        "sum":    sum_most,
        "spread": spread_most,
        "oe":     oe_most,
        "hl":     hl_most,
        # Counts for display
        "sum_pcts": {
            "L": round(low_cnt/n*100, 1),
            "M": round(mid_cnt/n*100, 1),
            "H": round(high_cnt/n*100, 1),
        },
        "spread_pcts": {
            "M": round(med_cnt/n*100, 1),
            "W": round(wide_cnt/n*100, 1),
        },
    }


def ask_filters(ranges, game, dataset_label, draws=None):
    """Ask filter preferences. Skips sum/spread/odd-even for pick format."""
    fmt   = game["format"]
    picks = game["picks"]
    name  = game["name"]
    r     = ranges

    print()
    print("=" * 55)
    print(f"  Generation Filters — {name}")
    print(f"  Dataset: {dataset_label}")
    print("=" * 55)

    filters = {
        "sum_min": r["sum_min"], "sum_max": r["sum_max"],
        "spread_min": 0, "spread_max": 999,
        "odd_min": 0, "odd_max": picks,
    }

    if fmt == "pick":
        print("\n  Pick games use pure frequency weighting only.")
        print("  No additional filters available for digit-based games.")
        return filters

    # Calculate dynamic hints from active dataset
    hints = get_dataset_hints(draws, game, r) if draws else {}

    def mc(key):
        """Return most common label if this option wins in the dataset."""
        pcts = hints.get("sum_pcts", {})
        sp   = hints.get("spread_pcts", {})
        if hints.get("sum") == key:
            return f"  <- most common ({pcts.get(key, 0):.0f}% of dataset)"
        if hints.get("spread") == key:
            return f"  <- most common ({sp.get(key, 0):.0f}% of dataset)"
        if hints.get("oe") == key:
            return f"  <- most common in dataset"
        if hints.get("hl") == key:
            return f"  <- most common in dataset"
        return ""

    # Sum filter
    print(f"\n  [1] SUM  (dataset avg: {r['avg_sum']:.0f})")
    print(f"      [A] Any   ({r['sum_min']} to {r['sum_max']})")
    print(f"      [L] Low   ({r['sum_min']} to {r['sum_low_max']}){mc('L')}")
    print(f"      [M] Mid   ({r['sum_mid_min']} to {r['sum_mid_max']}){mc('M')}")
    print(f"      [H] High  ({r['sum_high_min']} to {r['sum_max']}){mc('H')}")
    while True:
        s = input("      A, L, M, or H: ").strip().upper()
        if s in ("A","L","M","H"):
            break
        print("      Please enter A, L, M, or H.")
    filters["sum_min"], filters["sum_max"] = {
        "A": (r["sum_min"],     r["sum_max"]),
        "L": (r["sum_min"],     r["sum_low_max"]),
        "M": (r["sum_mid_min"], r["sum_mid_max"]),
        "H": (r["sum_high_min"],r["sum_max"]),
    }[s]

    # Spread filter
    print(f"\n  [2] SPREAD  (dataset avg: {r['avg_spread']:.0f})")
    print(f"      [A] Any")
    print(f"      [M] Medium  (16-30){mc('M') if hints.get('spread')=='M' else ''}")
    print(f"      [W] Wide    (31+){mc('W') if hints.get('spread')=='W' else ''}")
    while True:
        sp = input("      A, M, or W: ").strip().upper()
        if sp in ("A","M","W"):
            break
        print("      Please enter A, M, or W.")
    filters["spread_min"], filters["spread_max"] = {
        "A": (0, 999), "M": (16, 30), "W": (31, 999)
    }[sp]

    # Odd/Even filter
    print(f"\n  [3] ODD/EVEN")
    print(f"      [A] Any")
    if picks == 6:
        print(f"      [B] Balanced  (3 odd / 3 even){mc('B') if hints.get('oe')=='B' else ''}")
        print(f"      [O] Odd-heavy (4-5 odd){mc('O') if hints.get('oe')=='O' else ''}")
        print(f"      [E] Even-heavy(4-5 even){mc('E') if hints.get('oe')=='E' else ''}")
        while True:
            oe = input("      A, B, O, or E: ").strip().upper()
            if oe in ("A","B","O","E"):
                break
            print("      Please enter A, B, O, or E.")
        filters["odd_min"], filters["odd_max"] = {
            "A": (0,6), "B": (3,3), "O": (4,5), "E": (1,2)
        }[oe]
    elif picks == 7:
        print(f"      [B] Balanced  (3-4 odd){mc('B') if hints.get('oe')=='B' else ''}")
        print(f"      [O] Odd-heavy (5+ odd){mc('O') if hints.get('oe')=='O' else ''}")
        print(f"      [E] Even-heavy(5+ even){mc('E') if hints.get('oe')=='E' else ''}")
        while True:
            oe = input("      A, B, O, or E: ").strip().upper()
            if oe in ("A","B","O","E"):
                break
            print("      Please enter A, B, O, or E.")
        filters["odd_min"], filters["odd_max"] = {
            "A": (0,7), "B": (3,4), "O": (5,7), "E": (0,2)
        }[oe]
    else:
        half = picks // 2
        print(f"      [B] Balanced  ({half} odd / {picks-half} even){mc('B') if hints.get('oe')=='B' else ''}")
        while True:
            oe = input("      A or B: ").strip().upper()
            if oe in ("A","B"):
                break
            print("      Please enter A or B.")
        filters["odd_min"], filters["odd_max"] = {
            "A": (0, picks), "B": (half, half)
        }[oe]

    # ── High/Low balance filter ───────────────────────────────────────────────
    third    = game["pool"] // 3
    lo_max   = third
    mid_min  = third + 1
    mid_max  = third * 2
    hi_min   = third * 2 + 1

    print(f"\n  [4] HIGH/LOW BALANCE")
    print(f"      Low  = 1-{lo_max}   Mid = {mid_min}-{mid_max}   High = {hi_min}-{game['pool']}")
    print(f"      [A] Any")
    print(f"      [B] Balanced   (spread across all zones){mc('B') if hints.get('hl')=='B' else ''}")
    print(f"      [L] Low-heavy  (mostly low numbers){mc('L') if hints.get('hl')=='L' else ''}")
    print(f"      [H] High-heavy (mostly high numbers){mc('H') if hints.get('hl')=='H' else ''}")
    while True:
        hl = input("      A, B, L, or H: ").strip().upper()
        if hl in ("A","B","L","H"):
            break
        print("      Please enter A, B, L, or H.")
    filters["hl_choice"] = hl
    filters["pool"]      = game["pool"]

    # ── Never appeared together filter ─────────────────────────────────────────
    print(f"\n  [5] NEVER APPEARED TOGETHER")
    print(f"      Reject any set that has appeared exactly in history.")
    print(f"      [Y] Yes - ensure this is a unique combination")
    print(f"      [N] No  - not required")
    while True:
        nat = input("      Y or N: ").strip().upper()
        if nat in ("Y","N"):
            break
        print("      Please enter Y or N.")
    filters["never_appeared"] = (nat == "Y")

    return filters


def is_valid(draw, filters, fmt, draw_set=None):
    if fmt == "pick":
        return True  # No filters for pick games
    total  = sum(draw)
    spread = max(draw) - min(draw)
    odds   = sum(1 for n in draw if n % 2 != 0)

    # Basic filters
    if not (filters["sum_min"]    <= total  <= filters["sum_max"] and
            filters["spread_min"] <= spread <= filters["spread_max"] and
            filters["odd_min"]    <= odds   <= filters["odd_max"]):
        return False

    # High/Low balance filter
    hl = filters.get("hl_choice", "A")
    if hl != "A":
        pool   = filters.get("pool", 49)
        third  = pool // 3
        lo_cnt = sum(1 for n in draw if n <= third)
        hi_cnt = sum(1 for n in draw if n > third * 2)
        mi_cnt = len(draw) - lo_cnt - hi_cnt
        picks  = len(draw)

        if hl == "B":
            # Balanced: each zone has at least 1 number, no zone has more than half
            if lo_cnt == 0 or hi_cnt == 0 or mi_cnt == 0:
                return False
            if lo_cnt > picks // 2 or hi_cnt > picks // 2 or mi_cnt > picks // 2:
                return False
        elif hl == "L":
            # Low-heavy: majority in low zone
            if lo_cnt <= picks // 2:
                return False
        elif hl == "H":
            # High-heavy: majority in high zone
            if hi_cnt <= picks // 2:
                return False

    # Never appeared together filter
    if filters.get("never_appeared") and draw_set is not None:
        if draw in draw_set:
            return False

    return True


# ── Generator ─────────────────────────────────────────────────────────────────

def generate_numbers(freq, game, filters, num_sets=1,
                      locked_nums=None, draws=None, max_attempts=10000):
    """
    Generate number sets using frequency-weighted selection without replacement.
    locked_nums: list of numbers guaranteed in every set (favorites + overdue).
    draws:       full draw history used for never-appeared-together check.
    Retries until filters are satisfied or max_attempts reached.
    """
    picks      = game["picks"]
    fmt        = game["format"]
    pool       = game["pool"]
    lo         = 0 if fmt == "pick" else 1
    locked     = list(locked_nums) if locked_nums else []

    # Validate locked numbers fit in the game
    locked = [n for n in locked if lo <= n <= pool][:picks - 2]

    # Build set of historical draws for never-appeared check
    draw_set = set(draws) if draws and filters.get("never_appeared") else None

    # Ensure all pool numbers are in freq (fill missing with weight 1)
    full_freq   = {n: freq.get(n, 1) for n in range(lo, pool + 1)}
    gen_numbers = [n for n in full_freq.keys() if n not in locked]
    gen_weights = [full_freq[n] for n in gen_numbers]

    results = []
    skipped = 0

    for _ in range(num_sets):
        for attempt in range(max_attempts):
            draw  = list(locked)
            rem_n = gen_numbers[:]
            rem_w = gen_weights[:]

            while len(draw) < picks:
                chosen = random.choices(rem_n, weights=rem_w, k=1)[0]
                idx    = rem_n.index(chosen)
                draw.append(chosen)
                rem_n.pop(idx)
                rem_w.pop(idx)

            if fmt == "pick":
                draw = tuple(draw)
            else:
                draw = tuple(sorted(draw))

            if is_valid(draw, filters, fmt, draw_set):
                results.append(draw)
                break
        else:
            skipped += 1

    if skipped:
        print(f"\n  Note: {skipped} set(s) could not satisfy filters after "
              f"{max_attempts:,} attempts.")
        print("  Try loosening your filter choices or reducing locked numbers.")

    return results


def format_draw(draw, game):
    """Format a draw tuple for display."""
    fmt   = game["format"]
    picks = game["picks"]
    if fmt == "pick":
        return " - ".join(str(n) for n in draw)
    else:
        return " - ".join(f"{n:>2}" for n in draw)


# ── Explain Draw ──────────────────────────────────────────────────────────────

def explain_draw(draw, game, filters, freq, locked_nums, dataset_label):
    """Generate a plain-English explanation of why this set was produced."""
    picks   = len(draw)
    pool    = game["pool"]
    third   = pool // 3
    total   = sum(draw)
    spread  = max(draw) - min(draw)
    odds    = sum(1 for n in draw if n % 2 != 0)
    evens   = picks - odds
    lo_cnt  = sum(1 for n in draw if n <= third)
    hi_cnt  = sum(1 for n in draw if n > third * 2)
    mi_cnt  = picks - lo_cnt - hi_cnt
    consec  = sum(1 for i in range(len(draw)-1) if draw[i+1]-draw[i]==1)

    reasons = []

    # Dataset
    reasons.append(f"Generated from {dataset_label}")

    # Locked numbers
    if locked_nums:
        locked_in = [n for n in locked_nums if n in draw]
        if locked_in:
            reasons.append(f"Includes locked numbers: "
                          f"{', '.join(str(n) for n in sorted(locked_in))}")

    # Frequency insight - are the generated numbers hot or cold?
    if freq:
        gen_nums  = [n for n in draw if n not in (locked_nums or [])]
        if gen_nums:
            avg_freq  = sum(freq.values()) / len(freq)
            hot_picks = [n for n in gen_nums if freq.get(n,0) > avg_freq * 1.2]
            cold_picks= [n for n in gen_nums if freq.get(n,0) < avg_freq * 0.8]
            if hot_picks:
                reasons.append(f"Frequency-weighted hot picks: "
                               f"{', '.join(str(n) for n in sorted(hot_picks))}")
            if cold_picks:
                reasons.append(f"Lower-frequency picks included: "
                               f"{', '.join(str(n) for n in sorted(cold_picks))}")

    # Sum
    reasons.append(f"Sum = {total} "
                  f"(filter: {filters['sum_min']}-{filters['sum_max']})")

    # Spread
    reasons.append(f"Spread = {spread} "
                  f"({'wide' if spread >= 31 else 'medium' if spread >= 16 else 'narrow'})")

    # Odd/Even
    reasons.append(f"Balance = {odds} odd / {evens} even")

    # High/Low
    hl = filters.get("hl_choice", "A")
    if hl != "A":
        reasons.append(f"Zone split = {lo_cnt} low / {mi_cnt} mid / {hi_cnt} high "
                      f"(1-{third} / {third+1}-{third*2} / {third*2+1}-{pool})")

    # Consecutive
    if consec:
        pairs = [draw[i] for i in range(len(draw)-1) if draw[i+1]-draw[i]==1]
        reasons.append(f"Contains {consec} consecutive pair(s): "
                      f"{', '.join(str(n) for n in pairs)}")

    # Never appeared
    if filters.get("never_appeared"):
        reasons.append("Verified unique — this exact combination has never been drawn")

    return reasons


# ── Check My Numbers ──────────────────────────────────────────────────────────

def check_my_numbers(draws, game, script_dir):
    """
    Let the user enter their favourite numbers and check how they
    have historically performed across all draws in the database.
    Shows exact matches, partial matches, and best historical result.
    Optionally loads draws with dates for date display.
    """
    picks  = game["picks"]
    pool   = game["pool"]
    fmt    = game["format"]
    name   = game["name"]
    lo     = 0 if fmt == "pick" else 1
    n      = len(draws)

    if not draws:
        print("\n  No historical data available for this game.")
        return

    # Load draws with dates if available
    dated_draws = []
    if game.get("csv"):
        csv_path = os.path.join(script_dir, game["csv"])
        try:
            with open(csv_path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                fieldnames = reader.fieldnames or []
                has_date = "Draw_Date" in fieldnames
                for row in reader:
                    try:
                        nums = tuple(sorted(
                            int(row[f"N{i}"]) for i in range(1, picks + 1)
                        ))
                        date = row.get("Draw_Date", "") if has_date else ""
                        dated_draws.append((nums, date))
                    except:
                        continue
        except:
            dated_draws = [(d, "") for d in draws]
    else:
        dated_draws = [(d, "") for d in draws]

    print()
    print("=" * 55)
    print(f"  Have My Numbers Ever Won? — {name}")
    print(f"  Checking against {n:,} historical draws")
    print("=" * 55)
    print(f"\n  Enter up to {picks} numbers (1-{pool}), separated by commas.")
    print(f"  Example: 7, 14, 22, 35, 41, 48")
    print()

    while True:
        raw = input("  Your numbers: ").strip()
        if not raw:
            return
        try:
            user_nums = [int(x.strip()) for x in raw.split(",")]
            if not user_nums:
                raise ValueError
            if not all(lo <= n <= pool for n in user_nums):
                print(f"  All numbers must be between {lo} and {pool}.")
                continue
            if len(user_nums) != len(set(user_nums)):
                print("  Please enter unique numbers — no duplicates.")
                continue
            if len(user_nums) > picks:
                print(f"  Maximum {picks} numbers for {name}.")
                continue
            break
        except ValueError:
            print("  Please enter valid numbers separated by commas.")

    user_set  = set(user_nums)
    user_tuple = tuple(sorted(user_nums))
    checking  = len(user_nums)

    print()
    print(f"  Checking {checking} number(s): "
          f"{', '.join(str(n) for n in sorted(user_nums))}")
    print("  " + "-" * 51)

    # ── Exact match ───────────────────────────────────────────────────────────
    if checking == picks:
        exact = [(d, date) for d, date in dated_draws if d == user_tuple]
        if exact:
            print(f"\n  EXACT MATCH ({picks}/{picks} numbers):")
            print(f"  This exact combination has been drawn {len(exact)} time(s)!")
            for draw, date in exact[:5]:
                date_str = f"  {date}" if date else ""
                print(f"    {' - '.join(f'{n:>2}' for n in draw)}{date_str}")
        else:
            print(f"\n  EXACT MATCH ({picks}/{picks}): Never drawn")
            print(f"  This combination has never appeared in {n:,} draws.")

    # ── Partial matches ───────────────────────────────────────────────────────
    print()
    best_match = 0
    for match_count in range(min(checking, picks), 1, -1):
        matches = [
            (d, date) for d, date in dated_draws
            if len(set(d) & user_set) == match_count
        ]
        if matches:
            best_match = max(best_match, match_count)
            pct = len(matches) / n * 100
            print(f"  {match_count} of {checking} matched: "
                  f"{len(matches):,} draws ({pct:.1f}%)")
            # Show up to 3 examples for the best matches
            if match_count >= checking - 1:
                for draw, date in matches[:3]:
                    matched = sorted(set(draw) & user_set)
                    date_str = f"  ({date})" if date else ""
                    print(f"    {' - '.join(f'{n:>2}' for n in draw)}"
                          f"  matched: {matched}{date_str}")
        else:
            print(f"  {match_count} of {checking} matched: 0 draws")

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    print("  " + "-" * 51)
    if best_match == picks:
        print(f"  Best result: JACKPOT — exact match found!")
    elif best_match > 0:
        print(f"  Best historical result: {best_match} of {checking} numbers matched")
    else:
        print(f"  No historical matches found for these numbers.")

    print()
    print("  Note: Matching past draws does not affect future")
    print("  lottery outcomes. Each draw is an independent")
    print("  random event.")
    print()


# ── Save Results ───────────────────────────────────────────────────────────────

def save_results(game, sets, filters, dataset_label, output_file, locked_nums=None):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(output_file, "a", encoding="utf-8") as f:
        f.write("\n" + "=" * 50 + "\n")
        f.write(f"  Game   : {game['name']}\n")
        f.write(f"  Date   : {timestamp}\n")
        f.write(f"  Dataset: {dataset_label}\n")
        if locked_nums:
            f.write(f"  Locked : {', '.join(str(n) for n in sorted(locked_nums))}\n")
        f.write(f"  Filters: Sum {filters['sum_min']}-{filters['sum_max']}  "
                f"Spread {filters['spread_min']}-{filters['spread_max']}  "
                f"Odd {filters['odd_min']}-{filters['odd_max']}\n")
        f.write("=" * 50 + "\n")
        for i, draw in enumerate(sets, 1):
            f.write(f"  Set {i:>2}: {format_draw(draw, game)}\n")
        f.write("-" * 50 + "\n")


# ── Add Custom Game ────────────────────────────────────────────────────────────

def add_custom_game(script_dir):
    """Walk user through adding a new custom game."""
    print()
    print("=" * 55)
    print("  Add a Custom Game")
    print("=" * 55)

    name = input("\n  Game name (e.g. 'Powerball', 'UK Lotto'): ").strip()
    if not name:
        print("  Name cannot be empty.")
        return

    print("\n  Game format:")
    print("  [1] Standard  (pick N numbers from a pool)")
    print("  [2] Pick      (pick N single digits 0-9)")
    print("  [3] Keno      (pick many from a large pool)")
    while True:
        fc = input("  Enter 1, 2, or 3: ").strip()
        if fc in ("1","2","3"):
            break
        print("  Please enter 1, 2, or 3.")
    fmt = {"1": "standard", "2": "pick", "3": "keno"}[fc]

    while True:
        try:
            picks = int(input(f"\n  How many numbers does the player pick? ").strip())
            if picks >= 1:
                break
        except ValueError:
            pass
        print("  Please enter a positive number.")

    if fmt == "pick":
        pool = 9  # Digits 0-9
    else:
        while True:
            try:
                pool = int(input(f"  What is the highest number in the pool? ").strip())
                if pool > picks:
                    break
                print(f"  Pool must be larger than picks ({picks}).")
            except ValueError:
                pass
            print("  Please enter a valid number.")

    has_bonus = False
    if fmt != "pick":
        hb = input("\n  Does this game have a bonus number? (Y/N): ").strip().upper()
        has_bonus = hb == "Y"

    region = input("\n  Region/Country (e.g. 'USA', 'UK'): ").strip()

    print("\n  Do you have historical draw data for this game?")
    print("  [1] Yes - I have a CSV file to upload")
    print("  [2] No  - Use pure probability only")
    while True:
        dc = input("  Enter 1 or 2: ").strip()
        if dc in ("1","2"):
            break
        print("  Please enter 1 or 2.")

    csv_file = None
    if dc == "1":
        print("\n  CSV format required:")
        print(f"  Columns: N1, N2, ... N{picks}, Bonus (optional)")
        print("  Optional: Draw_Date column")
        print("  Example: N1,N2,N3,N4,N5,N6,Bonus")
        print("           3,12,24,35,41,48,7")
        csv_name = input(f"\n  Enter CSV filename (must be in your Quick pick folder): ").strip()
        csv_path = os.path.join(script_dir, csv_name)
        if os.path.exists(csv_path):
            test = load_csv(csv_path, picks, pool, fmt)
            if test:
                print(f"  Found {len(test):,} draws in {csv_name}")
                csv_file = csv_name
            else:
                print(f"  Warning: Could not read draws from {csv_name}")
                print("  Game will use pure probability instead.")
        else:
            print(f"  Warning: {csv_name} not found in your folder.")
            print("  Game will use pure probability until you add the file.")
            csv_file = csv_name  # Store name anyway for future use

    # Build game config
    game = {
        "name":      name,
        "format":    fmt,
        "picks":     picks,
        "pool":      pool,
        "has_bonus": has_bonus,
        "csv":       csv_file,
        "region":    region,
    }

    # Save to custom games
    custom = load_custom_games(script_dir)
    key    = f"C{len(custom) + 1}"
    custom[key] = game
    save_custom_games(custom, script_dir)

    print(f"\n  '{name}' added successfully as game [{key}]!")
    return key


# ── Game Loading ───────────────────────────────────────────────────────────────

def load_game_draws(game, script_dir):
    """Load draws for a game config. Returns [] if no CSV or file missing."""
    if not game.get("csv"):
        return []
    path = os.path.join(script_dir, game["csv"])
    if not os.path.exists(path):
        return []
    print(f"\n  Loading {game['name']} data...")
    draws = load_csv(path, game["picks"], game["pool"], game["format"])
    return draws


# ── Monthly Report ────────────────────────────────────────────────────────────

def generate_monthly_report(script_dir):
    """
    Auto-generate a LottoIQ Monthly Analytics Report .docx for all 4 built-in
    games using the last 30 draws for hot/cold/overdue/pairs stats.
    Saves the file to the same folder as lotto_generator.py.
    """
    import subprocess
    import json as _json
    from datetime import datetime

    month_label = datetime.now().strftime("%B %Y")          # e.g. "June 2026"
    month_slug  = datetime.now().strftime("%B%Y")           # e.g. "June2026"
    out_name    = f"LottoIQ_Monthly_Report_{month_slug}.docx"
    out_path    = os.path.join(script_dir, out_name)

    print()
    print("=" * 55)
    print(f"  Generating Monthly Report — {month_label}")
    print("=" * 55)

    # ── Collect stats for all 4 built-in games ────────────────────────────────
    games_data = []
    for key, game in BUILTIN_GAMES.items():
        name  = game["name"]
        picks = game["picks"]
        pool  = game["pool"]
        fmt   = game["format"]

        print(f"\n  Loading {name}...")
        csv_path = os.path.join(script_dir, game["csv"])
        draws    = load_csv(csv_path, picks, pool, fmt)
        total    = len(draws)

        if not draws:
            print(f"  WARNING: No data found for {name} — skipping.")
            continue

        last30       = draws[:30]
        freq30       = build_frequency(last30, pool, fmt)
        freq_all     = build_frequency(draws,  pool, fmt)
        sorted_freq  = sorted(freq30.items(), key=lambda x: x[1], reverse=True)

        hot   = sorted_freq[:5]
        cold  = sorted(sorted_freq[-5:], key=lambda x: x[1])

        overdue = get_overdue(last30, pool)[:5]
        pairs   = get_common_pairs(last30, 1)

        # Avg sum
        sums30   = [sum(d) for d in last30]
        sums_all = [sum(d) for d in draws]
        avg30    = sum(sums30)   / len(sums30)   if sums30   else 0
        avg_all  = sum(sums_all) / len(sums_all) if sums_all else 0

        top_pair = pairs[0] if pairs else None

        games_data.append({
            "name":      name,
            "picks":     picks,
            "pool":      pool,
            "total":     total,
            "game":      game,
            "hot":       hot,
            "cold":      cold,
            "overdue":   overdue,
            "avg30":     round(avg30, 1),
            "avg_all":   round(avg_all, 1),
            "top_pair":  top_pair,
        })

    if not games_data:
        print("\n  No game data available. Report not generated.")
        return

    # ── Build descriptions for hot/cold/overdue rows ──────────────────────────
    def hot_desc(rank, num, cnt):
        descs = [
            "Hottest number — appeared in more than 1 in 4 recent draws",
            "Consistently appearing at the high end of the range",
            "Mid-range presence staying strong recently",
            "Reliable recent performer",
            "High-range number maintaining momentum",
        ]
        return descs[rank] if rank < len(descs) else "Frequent recent performer"

    def cold_desc(rank, num, cnt):
        descs = [
            "Most overdue — long cold streak in recent draws",
            "Long-term underperformer recently",
            "Quiet stretch in recent draws",
            "Below recent average frequency",
            "Below recent average frequency",
        ]
        return descs[rank] if rank < len(descs) else "Below recent average frequency"

    def overdue_desc(rank, num, ago):
        if ago == 0:
            return "Recently drawn"
        descs = [
            f"Longest absence — last drawn {ago} draws ago",
            f"Extended gap from recent draws",
            f"Not seen in nearly 3 weeks of draws",
            f"Tied for most overdue",
            f"Quiet stretch continuing",
        ]
        return descs[rank] if rank < len(descs) else f"Last drawn {ago} draws ago"

    # ── Write the JS file that builds the docx ───────────────────────────────
    js_path = os.path.join(script_dir, "_report_gen.js")

    # Serialise game data to JSON for the JS script
    js_data = _json.dumps(games_data, default=str)

    js_script = f"""
const fs   = require('fs');
const path = require('path');
const {{
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, ShadingType,
    HeadingLevel, PageNumber, Header, Footer, TabStopType, TabStopPosition,
}} = require('docx');

const OUT_PATH  = {_json.dumps(out_path)};
const MONTH     = {_json.dumps(month_label)};
const gamesData = {js_data};

// ── Colours ────────────────────────────────────────────────────────────────
const NAVY   = "0A0E1A";
const GOLD   = "D4AF37";
const WHITE  = "FFFFFF";
const LIGHT  = "F5F5F0";
const MID    = "DDDDDD";

// ── Border helpers ─────────────────────────────────────────────────────────
const thinBorder = {{ style: BorderStyle.SINGLE, size: 1, color: MID }};
const allBorders = {{ top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }};

const noBorder   = {{ style: BorderStyle.NONE, size: 0, color: "FFFFFF" }};
const noBorders  = {{ top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }};

// ── Cell builder ───────────────────────────────────────────────────────────
function cell(text, opts = {{}}) {{
    const {{
        bold = false, fill = null, color = "000000",
        width = 3120, align = AlignmentType.LEFT, size = 20,
    }} = opts;
    return new TableCell({{
        borders: allBorders,
        width: {{ size: width, type: WidthType.DXA }},
        shading: fill ? {{ fill, type: ShadingType.CLEAR }} : undefined,
        margins: {{ top: 80, bottom: 80, left: 120, right: 120 }},
        children: [new Paragraph({{
            alignment: align,
            children: [new TextRun({{ text: String(text), bold, color, size, font: "Arial" }})],
        }})],
    }});
}}

// ── Table header row ───────────────────────────────────────────────────────
function headerRow(labels, widths) {{
    return new TableRow({{
        children: labels.map((lbl, i) =>
            new TableCell({{
                borders: allBorders,
                width: {{ size: widths[i], type: WidthType.DXA }},
                shading: {{ fill: WHITE, type: ShadingType.CLEAR }},
                margins: {{ top: 80, bottom: 80, left: 120, right: 120 }},
                children: [new Paragraph({{
                    children: [new TextRun({{ text: lbl, bold: true, color: NAVY, size: 20, font: "Arial" }})],
                }})],
            }})
        ),
    }});
}}

// ── Section heading paragraph ──────────────────────────────────────────────
function sectionHeading(text) {{
    return new Paragraph({{
        spacing: {{ before: 280, after: 100 }},
        border: {{ bottom: {{ style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 1 }} }},
        children: [new TextRun({{ text, bold: true, color: NAVY, size: 26, font: "Arial" }})],
    }});
}}

function subHeading(text) {{
    return new Paragraph({{
        spacing: {{ before: 180, after: 60 }},
        children: [new TextRun({{ text, bold: true, color: NAVY, size: 22, font: "Arial" }})],
    }});
}}

function bodyPara(text, opts = {{}}) {{
    const {{ bold = false, color = "333333", size = 20, spacing = {{ before: 0, after: 80 }} }} = opts;
    return new Paragraph({{
        spacing,
        children: [new TextRun({{ text, bold, color, size, font: "Arial" }})],
    }});
}}

function spacer() {{
    return new Paragraph({{ spacing: {{ before: 0, after: 120 }} }});
}}

// ── Hot/Cold/Overdue table ─────────────────────────────────────────────────
function statsTable(rows, widths) {{
    return new Table({{
        width: {{ size: 9360, type: WidthType.DXA }},
        columnWidths: widths,
        rows: rows.map((r, ri) =>
            new TableRow({{
                children: r.map((val, ci) =>
                    new TableCell({{
                        borders: allBorders,
                        width: {{ size: widths[ci], type: WidthType.DXA }},
                        shading: {{ fill: ri % 2 === 0 ? WHITE : LIGHT, type: ShadingType.CLEAR }},
                        margins: {{ top: 80, bottom: 80, left: 120, right: 120 }},
                        children: [new Paragraph({{
                            children: [new TextRun({{
                                text: String(val),
                                bold: ci === 0,
                                color: ci === 0 ? NAVY : "444444",
                                size: 20, font: "Arial",
                            }})],
                        }})],
                    }})
                ),
            }})
        ),
    }});
}}

// ── Build game section ─────────────────────────────────────────────────────
function gameSection(g) {{
    const items = [];
    const {{
        name, picks, pool, total,
        hot, cold, overdue, avg30, avg_all, top_pair,
    }} = g;

    // Game title bar with subtitle inline
    const gameDescs = {{
        "Lotto 6/49":  `Pick 6 from 1-49 | Draws: Wednesday & Saturday | Database: ${{total.toLocaleString()}} draws`,
        "Lotto MAX":   `Pick 7 from 1-52 | Draws: Tuesday & Friday | Database: ${{total.toLocaleString()}} draws`,
        "Lottario":    `Pick 6 from 1-45 | Draws: Every Saturday | Database: ${{total.toLocaleString()}} draws | Ontario only`,
        "Ontario 49":  `Pick 6 from 1-49 | Draws: Wednesday & Saturday | Database: ${{total.toLocaleString()}} draws | Ontario only`,
    }};
    items.push(new Paragraph({{
        spacing: {{ before: 320, after: 80 }},
        shading: {{ fill: NAVY, type: ShadingType.CLEAR }},
        border: {{
            top:    {{ style: BorderStyle.SINGLE, size: 12, color: GOLD }},
            bottom: {{ style: BorderStyle.SINGLE, size: 4,  color: GOLD }},
            left:   {{ style: BorderStyle.SINGLE, size: 12, color: GOLD }},
            right:  {{ style: BorderStyle.SINGLE, size: 12, color: GOLD }},
        }},
        children: [
            new TextRun({{ text: "  " + name + " ", bold: true, color: GOLD, size: 28, font: "Arial" }}),
            new TextRun({{ text: gameDescs[name] || `Pick ${{picks}} from 1-${{pool}} | Database: ${{total.toLocaleString()}} draws`, color: GOLD, size: 18, font: "Arial" }}),
        ],
    }}));

    // HOT NUMBERS
    items.push(subHeading("HOT NUMBERS"));
    items.push(bodyPara("Most frequently drawn in the last 30 draws:", {{ size: 18, color: "555555" }}));
    const hotDescs = [
        "Hottest number — appeared in more than 1 in 4 recent draws",
        "Consistently high-end performer this month",
        "Mid-range presence staying strong recently",
        "Reliable recent performer",
        "Maintaining momentum this month",
    ];
    const hotRows = hot.map(([num, cnt], i) => [
        `Number ${{num}}`, `${{cnt}} times`, hotDescs[i] || "Frequent recent performer",
    ]);
    items.push(statsTable(
        [["Number","Frequency","Note"], ...hotRows],
        [2000, 1500, 5860]
    ));
    items.push(spacer());

    // COLD NUMBERS
    items.push(subHeading("COLD NUMBERS"));
    items.push(bodyPara("Least frequently drawn in the last 30 draws:", {{ size: 18, color: "555555" }}));
    const coldDescs = [
        "Most overdue — extended cold streak in recent draws",
        "Long-term underperformer recently",
        "Quiet stretch in recent draws",
        "Below recent average frequency",
        "Below recent average frequency",
    ];
    const coldRows = cold.map(([num, cnt], i) => [
        `Number ${{num}}`, `${{cnt}} time${{cnt !== 1 ? "s" : ""}}`, coldDescs[i] || "Below recent average",
    ]);
    items.push(statsTable(
        [["Number","Frequency","Note"], ...coldRows],
        [2000, 1500, 5860]
    ));
    items.push(spacer());

    // MOST OVERDUE
    items.push(subHeading("MOST OVERDUE"));
    const overdueDescs = [
        "Longest absence in the current database window",
        "Extended gap from recent draws",
        "Not seen in nearly 3 weeks of draws",
        "Tied for most overdue",
        "Quiet stretch continuing",
    ];
    const overdueRows = overdue.map(([num, ago], i) => [
        `Number ${{num}}`,
        ago === 0 ? "Recent draw" : `${{ago}} draws ago`,
        overdueDescs[i] || `Last drawn ${{ago}} draws ago`,
    ]);
    items.push(statsTable(
        [["Number","Last Seen","Note"], ...overdueRows],
        [2000, 1700, 5660]
    ));
    items.push(spacer());

    // OTHER INSIGHTS
    items.push(subHeading("OTHER INSIGHTS"));
    items.push(bodyPara(`• Average sum of draws (last 30): ${{avg30}} (historical average: ${{avg_all}})`));
    if (top_pair) {{
        const [[n1, n2], cnt] = top_pair;
        items.push(bodyPara(`• Most common pair this month: ${{n1}} and ${{n2}} appeared together ${{cnt}} time${{cnt !== 1 ? "s" : ""}}`));
    }}
    items.push(bodyPara(`• Draws range: 1-${{pool}}`));
    items.push(spacer());

    return items;
}}

// ── Cover / header elements ────────────────────────────────────────────────
const coverBlock = [
    new Paragraph({{
        alignment: AlignmentType.CENTER,
        spacing: {{ before: 0, after: 80 }},
        shading: {{ fill: NAVY, type: ShadingType.CLEAR }},
        children: [new TextRun({{ text: "LottoIQ", bold: true, color: GOLD, size: 56, font: "Arial" }})],
    }}),
    new Paragraph({{
        alignment: AlignmentType.CENTER,
        spacing: {{ before: 0, after: 200 }},
        shading: {{ fill: NAVY, type: ShadingType.CLEAR }},
        children: [new TextRun({{ text: "Numbers, driven by Numbers.", color: WHITE, size: 22, font: "Arial", italics: true }})],
    }}),
    new Paragraph({{
        alignment: AlignmentType.CENTER,
        spacing: {{ before: 160, after: 60 }},
        children: [new TextRun({{ text: "MONTHLY ANALYTICS REPORT", bold: true, color: NAVY, size: 32, font: "Arial" }})],
    }}),
    new Paragraph({{
        alignment: AlignmentType.CENTER,
        spacing: {{ before: 0, after: 240 }},
        children: [new TextRun({{ text: MONTH + " | lottoiq.ca", color: "666666", size: 22, font: "Arial" }})],
    }}),
    bodyPara(
        "Welcome to your LottoIQ Monthly Analytics Report. Each month we pull the latest " +
        "historical data from our databases — covering thousands of draws across four major " +
        "Canadian lottery games — and surface the patterns that matter most.",
        {{ spacing: {{ before: 0, after: 120 }} }}
    ),
    new Paragraph({{
        spacing: {{ before: 0, after: 360 }},
        children: [
            new TextRun({{ text: "Important: ", bold: true, color: "AA0000", size: 20, font: "Arial" }}),
            new TextRun({{ text: "Lottery draws are completely random. Past frequency does not predict future results. " +
                "This report is for entertainment and informational purposes only. We never claim to improve your odds of winning.",
                color: "555555", size: 20, font: "Arial" }}),
        ],
    }}),
];

// ── Disclaimer footer ──────────────────────────────────────────────────────
const disclaimerBlock = [
    spacer(),
    new Paragraph({{
        spacing: {{ before: 200, after: 80 }},
        border: {{ top: {{ style: BorderStyle.SINGLE, size: 4, color: MID, space: 1 }} }},
        children: [new TextRun({{ text: "Important Disclaimer", bold: true, color: NAVY, size: 22, font: "Arial" }})],
    }}),
    bodyPara(
        "All statistics in this report are based on historical draw data only. Lottery draws are " +
        "independent random events. Past frequency does not influence future outcomes. LottoIQ does " +
        "not predict or guarantee winning numbers. This report is for entertainment and informational " +
        "purposes only. Please play responsibly.",
        {{ color: "555555", size: 18 }}
    ),
    new Paragraph({{
        alignment: AlignmentType.CENTER,
        spacing: {{ before: 160, after: 0 }},
        children: [
            new TextRun({{ text: "LottoIQ.ca  |  info@lottoiq.ca  |  ", color: "888888", size: 18, font: "Arial" }}),
            new TextRun({{ text: "Numbers, driven by Numbers.", color: GOLD, size: 18, font: "Arial", italics: true }}),
        ],
    }}),
];

// ── Assemble document ──────────────────────────────────────────────────────
const allChildren = [
    ...coverBlock,
    ...gamesData.flatMap(g => gameSection(g)),
    ...disclaimerBlock,
];

const doc = new Document({{
    sections: [{{
        properties: {{
            page: {{
                size: {{ width: 12240, height: 15840 }},
                margin: {{ top: 1080, right: 1080, bottom: 1080, left: 1080 }},
            }},
        }},
        children: allChildren,
    }}],
}});

Packer.toBuffer(doc).then(buf => {{
    fs.writeFileSync(OUT_PATH, buf);
    console.log("OK:" + OUT_PATH);
}}).catch(err => {{
    console.error("ERROR:" + err.message);
    process.exit(1);
}});
"""

    with open(js_path, "w", encoding="utf-8") as f:
        f.write(js_script)

    print(f"\n  Building document...")
    result = subprocess.run(
        ["node", js_path],
        capture_output=True, text=True
    )

    # Clean up temp JS file
    try:
        os.remove(js_path)
    except OSError:
        pass

    if result.returncode == 0 and result.stdout.strip().startswith("OK:"):
        print(f"\n  ✅ Report saved to:")
        print(f"     {out_path}")
    else:
        err = result.stderr.strip() or result.stdout.strip()
        print(f"\n  ❌ Error generating report:")
        print(f"     {err}")
        return

    print()
    print("  Report includes (last 30 draws for each game):")
    for g in games_data:
        print(f"    • {g['name']:<20} {g['total']:,} total draws")


# ── Menu Helpers ───────────────────────────────────────────────────────────────

def print_main_menu(custom_games):
    print()
    print("=" * 55)
    print("   LottoIQ  |  Numbers, driven by Numbers")
    print("=" * 55)
    print()
    print("  BUILT-IN GAMES:")
    for key, g in BUILTIN_GAMES.items():
        print(f"  [{key}] {g['name']:<20} {g['picks']} from 1-{g['pool']}"
              f"  ({g['region']})")

    if custom_games:
        print()
        print("  CUSTOM GAMES:")
        for key, g in custom_games.items():
            pool_str = f"0-9" if g["format"] == "pick" else f"1-{g['pool']}"
            print(f"  [{key}] {g['name']:<20} {g['picks']} from {pool_str}"
                  f"  ({g.get('region','')})")

    print()
    print("  [S] View Stats")
    print("  [C] Check My Numbers")
    print("  [R] Generate Monthly Report")
    print("  [A] Add a custom game")
    print("  [Q] Quit")
    print()


def get_valid_choices(custom_games):
    choices = list(BUILTIN_GAMES.keys()) + list(custom_games.keys())
    choices += ["S","C","R","A","Q"]
    return choices


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    script_dir  = os.path.dirname(os.path.abspath(__file__))
    output_file = os.path.join(script_dir, "lotto_results.txt")
    draw_cache  = {}  # key -> draws list

    def get_draws(key, game):
        if key not in draw_cache:
            draws = load_game_draws(game, script_dir)
            draw_cache[key] = draws
        return draw_cache[key]

    while True:
        custom_games  = load_custom_games(script_dir)
        valid_choices = get_valid_choices(custom_games)
        print_main_menu(custom_games)

        while True:
            choice = input("  Your choice: ").strip().upper()
            if choice in valid_choices:
                break
            print(f"  Please enter a valid option.")

        # ── Quit ───────────────────────────────────────────────────────────────
        if choice == "Q":
            print("\n  Good luck! 🍀")
            input("  Press Enter to close...")
            break

        # ── Check My Numbers ───────────────────────────────────────────────────
        if choice == "C":
            print("\n  Which game would you like to check numbers for?")
            all_games = {**BUILTIN_GAMES, **custom_games}
            for k, g in all_games.items():
                print(f"  [{k}] {g['name']}")
            print()
            while True:
                cc = input("  Enter game key: ").strip().upper()
                if cc in all_games:
                    break
                print("  Please enter a valid game key.")
            game  = all_games[cc]
            draws = get_draws(cc, game)
            check_my_numbers(draws, game, script_dir)
            input("  Press Enter to return to the main menu...")
            continue

        # ── Add Custom Game ────────────────────────────────────────────────────
        if choice == "A":
            add_custom_game(script_dir)
            input("\n  Press Enter to return to the main menu...")
            continue

        # ── Generate Monthly Report ────────────────────────────────────────────
        if choice == "R":
            generate_monthly_report(script_dir)
            input("\n  Press Enter to return to the main menu...")
            continue

        # ── View Stats ─────────────────────────────────────────────────────────
        if choice == "S":
            all_games = {**BUILTIN_GAMES, **custom_games}
            print("\n  Which game would you like stats for?")
            for k, g in all_games.items():
                print(f"  [{k}] {g['name']}")
            print()
            while True:
                sc = input("  Enter game key: ").strip().upper()
                if sc in all_games:
                    break
                print("  Please enter a valid game key.")

            game  = all_games[sc]
            draws = get_draws(sc, game)

            if not draws:
                print(f"\n  No historical data for {game['name']}.")
                print("  Stats require historical draw data.")
                input("\n  Press Enter to return to the main menu...")
                continue

            # Lotto MAX: offer source selection before dataset slice
            if sc == "2":
                draws, source_label = ask_lotto_max_source(script_dir, draws)
            else:
                source_label = game["name"]

            active_draws, dataset_label = ask_dataset(draws, source_label)
            if active_draws is None:
                active_draws = draws
                dataset_label = f"All {len(draws):,} draws"

            freq = build_frequency(active_draws, game["pool"], game["format"])
            print_stats(active_draws, freq, game, dataset_label)
            input("  Press Enter to return to the main menu...")
            continue

        # ── Generate Numbers ───────────────────────────────────────────────────
        all_games = {**BUILTIN_GAMES, **custom_games}
        game      = all_games[choice]
        draws     = get_draws(choice, game)

        # Lotto MAX: offer source selection before dataset slice
        if choice == "2" and draws:
            draws, source_label = ask_lotto_max_source(script_dir, draws)
        else:
            source_label = game["name"]

        if not draws:
            print(f"\n  No historical data found for {game['name']}.")
            print("  Using pure probability (uniform weighting).")
            dataset_label = "Pure probability"
            active_draws  = None
        else:
            active_draws, dataset_label = ask_dataset(draws, source_label)

        # Build frequency
        if active_draws is None:
            freq   = build_uniform_frequency(game["pool"], game["format"])
            ranges = get_filter_ranges(draws) if draws else {
                "sum_min": game["picks"],
                "sum_max": game["pool"] * game["picks"],
                "sum_low_max":  game["pool"] * game["picks"] // 3,
                "sum_mid_min":  game["pool"] * game["picks"] // 4,
                "sum_mid_max":  game["pool"] * game["picks"] * 3 // 4,
                "sum_high_min": game["pool"] * game["picks"] * 2 // 3,
                "avg_sum":      game["pool"] * game["picks"] / 2,
                "avg_spread":   game["pool"] * 0.7,
            }
        else:
            freq   = build_frequency(active_draws, game["pool"], game["format"])
            ranges = get_filter_ranges(active_draws)

        # ── Ask favorites and overdue once per game session ──────────────
        fav_nums     = ask_favorites(choice, game, script_dir)
        overdue_nums = ask_overdue_picks(
            active_draws if active_draws else draws,
            game,
            len(fav_nums)
        )
        # Pair picks — share the locked number pool with favorites + overdue
        current_locked = len(fav_nums) + len(overdue_nums)
        pair_nums = ask_pair_picks(
            active_draws if active_draws else draws,
            game,
            current_locked
        )

        # Combine all locked numbers — no duplicates
        locked_nums = list(fav_nums)
        for n in overdue_nums:
            if n not in locked_nums:
                locked_nums.append(n)
        for n in pair_nums:
            if n not in locked_nums:
                locked_nums.append(n)

        # Enforce the picks-2 cap and warn if any numbers were dropped
        max_locked = game["picks"] - 2
        if len(locked_nums) > max_locked:
            dropped = locked_nums[max_locked:]
            locked_nums = locked_nums[:max_locked]
            print()
            print(f"  ⚠  Too many locked numbers for {game['name']} "
                  f"(max {max_locked}, need 2 slots free for generator).")
            print(f"     Dropped: {', '.join(str(n) for n in dropped)}")
            print(f"     Keeping: {', '.join(str(n) for n in locked_nums)}")

        if locked_nums:
            print()
            print(f"  Locked numbers for all sets: "
                  f"{', '.join(str(n) for n in sorted(locked_nums))}")
            if fav_nums:
                print(f"    Favorites : {', '.join(str(n) for n in fav_nums)}")
            if overdue_nums:
                print(f"    Overdue   : {', '.join(str(n) for n in overdue_nums)}")
            if pair_nums:
                print(f"    Pair      : {pair_nums[0]} & {pair_nums[1]}")

        while True:
            filters = ask_filters(ranges, game, dataset_label,
                                  draws=active_draws if active_draws else draws)

            while True:
                try:
                    num_sets = int(input(f"\n  How many sets of {game['name']} numbers? ").strip())
                    if num_sets >= 1:
                        break
                    print("  Please enter a positive number.")
                except ValueError:
                    print("  Please enter a valid number.")

            print()
            print(f"  Generating {num_sets} set(s) for {game['name']}...")
            print(f"  Dataset : {dataset_label}")
            if locked_nums:
                print(f"  Locked  : {', '.join(str(n) for n in sorted(locked_nums))}")
            if game["format"] != "pick":
                print(f"  Filters : Sum {filters['sum_min']}-{filters['sum_max']}  |  "
                      f"Spread {filters['spread_min']}-{filters['spread_max']}  |  "
                      f"Odd {filters['odd_min']}-{filters['odd_max']}")
            print("  " + "-" * 51)

            # Pass full draw history for never-appeared check (not just the active window)
            history = draws or []
            sets = generate_numbers(freq, game, filters, num_sets,
                                    locked_nums=locked_nums,
                                    draws=history)

            for i, draw in enumerate(sets, 1):
                line = f"  Set {i:>2}: {format_draw(draw, game)}"
                if game["format"] != "pick":
                    odds   = sum(1 for n in draw if n % 2 != 0)
                    spread = max(draw) - min(draw)
                    total  = sum(draw)
                    picks  = game["picks"]
                    line += f"   (sum={total}, spread={spread}, {odds}o/{picks-odds}e)"
                print(line)

                # Show reasoning
                if game["format"] != "pick":
                    reasons = explain_draw(draw, game, filters, freq,
                                          locked_nums, dataset_label)
                    print(f"         Why:")
                    for r in reasons:
                        print(f"           • {r}")
                    print()

            print("  " + "-" * 51)
            print("\n  Disclaimer: For entertainment only. Lottery draws")
            print("  are independent random events. Good luck! 🍀")

            save_results(game, sets, filters, dataset_label, output_file, locked_nums)
            print(f"\n  Results saved to: {output_file}")

            # ── What next? ─────────────────────────────────────────────────────
            print()
            print("  What would you like to do next?")
            print(f"  [1] Generate more {game['name']} numbers (same dataset)")
            print(f"  [2] Change dataset for {game['name']}")
            print("  [3] Return to main menu")
            print("  [Q] Quit")
            print()

            while True:
                again = input("  Enter 1, 2, 3, or Q: ").strip().upper()
                if again in ("1","2","3","Q"):
                    break
                print("  Please enter 1, 2, 3, or Q.")

            if again == "Q":
                print("\n  Good luck! 🍀")
                input("  Press Enter to close...")
                return
            elif again == "3":
                break
            elif again == "2":
                # Re-ask dataset — for Lotto MAX re-offer source selection too
                if choice == "2" and draws:
                    draws, source_label = ask_lotto_max_source(script_dir,
                                             get_draws(choice, game))
                if draws:
                    active_draws, dataset_label = ask_dataset(draws, source_label)
                if active_draws is None:
                    freq   = build_uniform_frequency(game["pool"], game["format"])
                    if draws:
                        ranges = get_filter_ranges(draws)
                else:
                    freq   = build_frequency(active_draws, game["pool"], game["format"])
                    ranges = get_filter_ranges(active_draws)
            # else [1]: loop with same dataset/freq


if __name__ == "__main__":
    main()
