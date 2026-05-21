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

    # Calculate overdue
    last_seen = {}
    for i, draw in enumerate(draws):
        for num in draw:
            last_seen[num] = i
    total   = len(draws)
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

def load_csv(csv_path: str, picks: int, pool: int, fmt: str) -> tuple[list, dict]:
    """
    Load historical draws from CSV.
    Handles standard (N1..Nn) and auto-detected column layouts.
    Returns (draws, draw_dates) where:
      draws      = list of sorted tuples of main numbers
      draw_dates = dict of index -> date string for draws that have a date
    """
    draw_dates = {}

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

        # Detect date column
        date_col = None
        for candidate in ("draw_date", "date", "Draw_Date", "Date", "DATE"):
            if candidate in fieldnames:
                date_col = candidate
                break

        idx = 0
        for row in reader:
            try:
                if fmt == "pick":
                    nums = [int(row[c]) for c in num_cols[:picks]]
                    if all(0 <= n <= 9 for n in nums):
                        if date_col and row.get(date_col, "").strip():
                            draw_dates[idx] = row[date_col].strip()
                        draws.append(tuple(nums))
                        idx += 1
                else:
                    nums = [int(row[c]) for c in num_cols[:picks]]
                    if all(1 <= n <= pool for n in nums):
                        if date_col and row.get(date_col, "").strip():
                            draw_dates[idx] = row[date_col].strip()
                        draws.append(tuple(sorted(nums)))
                        idx += 1
            except (ValueError, KeyError):
                continue

    return draws, draw_dates


# ── Dataset Selection ──────────────────────────────────────────────────────────

def _parse_date_flexible(date_str):
    """Try multiple common date formats; return datetime or None."""
    from datetime import datetime as _dt
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d",
                "%d-%m-%Y", "%m-%d-%Y", "%d %b %Y", "%B %d, %Y"):
        try:
            return _dt.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    return None


def ask_dataset(draws, game_name, draw_dates=None):
    """Ask which subset of draws to use. Returns (subset, label)."""
    total      = len(draws)
    draw_dates = draw_dates or {}
    has_dates  = bool(draw_dates)

    print()
    print("=" * 55)
    print(f"  Dataset — {game_name}")
    print("=" * 55)
    print(f"\n  Base your stats and picks on:")
    print(f"  [1] All historical draws  ({total:,} draws)")
    print(f"  [2] Last 90 draws         ({min(90, total)} draws)")
    print(f"  [3] Last 30 draws         ({min(30, total)} draws)")
    print(f"  [4] Pure probability      (no historical weighting)")
    if has_dates:
        parsed = [_parse_date_flexible(d) for d in draw_dates.values()]
        parsed = [d for d in parsed if d]
        if parsed:
            yr_min = min(d.year for d in parsed)
            yr_max = max(d.year for d in parsed)
            # If dates only cover a tiny slice of the full draw history,
            # the CSV predates the Draw_Date column being added. In that case
            # show the range as unknown rather than misleadingly narrow.
            date_coverage = len(parsed) / max(total, 1)
            if date_coverage < 0.05:
                print(f"  [5] Date range filter     (enter a year range)")
            else:
                print(f"  [5] Date range filter     ({yr_min} – {yr_max})")
    print()

    valid = ("1","2","3","4","5") if has_dates else ("1","2","3","4")
    prompt = "  Enter 1-5: " if has_dates else "  Enter 1, 2, 3, or 4: "
    while True:
        c = input(prompt).strip()
        if c in valid:
            break
        print(f"  Please enter one of: {', '.join(valid)}.")

    if c == "1": return draws,           f"All {total:,} draws"
    if c == "2": return draws[-90:],     "Last 90 draws"
    if c == "3": return draws[-30:],     "Last 30 draws"
    if c == "4": return None,            "Pure probability"

    # ── Date range filter ─────────────────────────────────────────────────────
    parsed_all = [_parse_date_flexible(d) for d in draw_dates.values()]
    parsed_all = [d for d in parsed_all if d]
    yr_min     = min(d.year for d in parsed_all) if parsed_all else 2000
    yr_max     = max(d.year for d in parsed_all) if parsed_all else datetime.now().year
    print()
    print(f"  Enter a year range to filter draws ({yr_min} to {yr_max}).")
    while True:
        try:
            yr_from = int(input("  From year: ").strip())
            yr_to   = int(input("  To year  : ").strip())
            if yr_from <= yr_to:
                break
            print("  'From' year must be <= 'To' year.")
        except ValueError:
            print("  Please enter valid 4-digit years.")

    from datetime import datetime as _dt
    subset = []
    for i, draw in enumerate(draws):
        ds = draw_dates.get(i, "")
        if not ds:
            continue  # Skip draws with no date when filtering
        pd = _parse_date_flexible(ds)
        if pd and yr_from <= pd.year <= yr_to:
            subset.append(draw)

    if not subset:
        print(f"  No draws found between {yr_from} and {yr_to}. Using all draws.")
        return draws, f"All {total:,} draws"

    label = f"{yr_from}–{yr_to} ({len(subset):,} draws)"
    print(f"  Found {len(subset):,} draws in that range.")
    return subset, label


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
    """Return list of (number, draws_since_last_seen) sorted most overdue first."""
    last_seen = {}
    for i, draw in enumerate(draws):
        for num in draw:
            last_seen[num] = i
    total   = len(draws)
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


def temperature_bar(cnt, min_cnt, max_cnt, width=20):
    """
    Return a coloured temperature bar string for a number's frequency.
    Uses ANSI escape codes: red=hot, yellow=warm, cyan=cool, blue=cold.
    Falls back gracefully if the terminal doesn't support colour.
    """
    if max_cnt == min_cnt:
        ratio = 0.5
    else:
        ratio = (cnt - min_cnt) / (max_cnt - min_cnt)

    filled = max(1, round(ratio * width))
    empty  = width - filled
    bar    = "█" * filled + "░" * empty

    # Pick colour based on ratio quartile
    if ratio >= 0.75:
        colour = "\033[91m"   # bright red   — HOT
    elif ratio >= 0.50:
        colour = "\033[93m"   # bright yellow — WARM
    elif ratio >= 0.25:
        colour = "\033[96m"   # bright cyan   — COOL
    else:
        colour = "\033[94m"   # bright blue   — COLD
    reset = "\033[0m"

    return f"{colour}{bar}{reset}"


def temperature_label(ratio):
    """Return a short temperature tag."""
    if ratio >= 0.75: return "🔥 HOT "
    if ratio >= 0.50: return "☀ WARM"
    if ratio >= 0.25: return "❄ COOL"
    return               "🧊 COLD"


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

    # Overdue
    last_seen = {}
    for i, draw in enumerate(draws):
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

    # ── Temperature gradient table ─────────────────────────────────────────────
    print(f"\n  NUMBER TEMPERATURE  (all {pool} numbers ranked by frequency)")
    print(f"  {'#':>3}  {'Drawn':>5}  {'Temp  ':6}  {'Frequency bar'}")
    print(f"  {'─'*3}  {'─'*5}  {'─'*6}  {'─'*20}")

    all_counts  = [freq.get(num, 0) for num in range(lo, pool + 1)]
    min_cnt     = min(all_counts)
    max_cnt_all = max(all_counts) if all_counts else 1

    for num in range(lo, pool + 1):
        cnt   = freq.get(num, 0)
        ratio = (cnt - min_cnt) / (max_cnt_all - min_cnt) if max_cnt_all != min_cnt else 0.5
        bar   = temperature_bar(cnt, min_cnt, max_cnt_all)
        tag   = temperature_label(ratio)
        print(f"  {num:>3}  {cnt:>5}  {tag}  {bar}")

    print(f"\n  HOT  (top 5 most frequent):")
    for num, cnt in hot:
        ratio = (cnt - min_cnt) / (max_cnt_all - min_cnt) if max_cnt_all != min_cnt else 0.5
        bar   = temperature_bar(cnt, min_cnt, max_cnt_all, width=12)
        print(f"    {num:>2}  appeared {cnt:>4} times  {bar}")

    print(f"\n  COLD (bottom 5 least frequent):")
    for num, cnt in cold:
        ratio = (cnt - min_cnt) / (max_cnt_all - min_cnt) if max_cnt_all != min_cnt else 0.5
        bar   = temperature_bar(cnt, min_cnt, max_cnt_all, width=12)
        print(f"    {num:>2}  appeared {cnt:>4} times  {bar}")

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


def hint(key, hints, label):
    """Return '← most common (X%)' if this option is most common in dataset."""
    if hints.get("sum") == key or hints.get("spread") == key or        hints.get("oe") == key or hints.get("hl") == key:
        return f"  <- most common in dataset"
    return ""


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



# ── Wheeling System ────────────────────────────────────────────────────────────

def ask_wheel(game, script_dir):
    """
    Full-wheel or abbreviated-wheel generator.
    Full wheel:  generate ALL combinations from a chosen pool of numbers.
    Abbreviated: generate a smart reduced set guaranteeing a N-match if any
                 N numbers from the pool are in the winning draw.
    Returns list of draw tuples, or [] if skipped.
    """
    if game["format"] == "pick":
        print("\n  Wheeling is not available for digit-based (Pick) games.")
        return []

    picks = game["picks"]
    pool  = game["pool"]
    name  = game["name"]

    print()
    print("=" * 55)
    print(f"  Wheeling — {name}")
    print("=" * 55)
    print()
    print("  Wheeling generates multiple tickets from a chosen pool")
    print("  of numbers, guaranteeing certain match levels.")
    print()
    print(f"  [1] Full wheel   — every possible combination")
    print(f"  [2] Key number   — one number in every ticket")
    print(f"  [3] Skip")
    print()

    while True:
        wc = input("  Enter 1, 2, or 3: ").strip()
        if wc in ("1","2","3"):
            break
        print("  Please enter 1, 2, or 3.")

    if wc == "3":
        return []

    # ── Collect the wheel pool ────────────────────────────────────────────────
    print()
    if wc == "1":
        min_pool = picks + 1
        max_pool = min(picks + 6, pool)  # Cap at +6 to keep combo count sane
        print(f"  Choose {min_pool}–{max_pool} numbers to wheel.")
        print(f"  (More numbers = exponentially more tickets)")
    else:
        min_pool = picks
        max_pool = min(picks + 8, pool)
        print(f"  Choose {min_pool}–{max_pool} numbers for the key-number wheel.")

    wheel_pool = []
    print(f"  Enter numbers 1–{pool}, one at a time. Press Enter to finish.")
    print()
    while len(wheel_pool) < max_pool:
        raw = input(f"  Number {len(wheel_pool)+1}: ").strip()
        if raw == "" and len(wheel_pool) >= min_pool:
            break
        if raw == "" and len(wheel_pool) < min_pool:
            print(f"  Need at least {min_pool} numbers.")
            continue
        if raw.isdigit() and 1 <= int(raw) <= pool:
            n = int(raw)
            if n not in wheel_pool:
                wheel_pool.append(n)
                print(f"  Added {n}  ({len(wheel_pool)} so far)")
            else:
                print(f"  {n} already in pool.")
        else:
            print(f"  Please enter a number between 1 and {pool}.")

    if len(wheel_pool) < min_pool:
        print("  Not enough numbers entered. Skipping wheel.")
        return []

    # ── Full wheel ────────────────────────────────────────────────────────────
    if wc == "1":
        from itertools import combinations as _comb
        combos = list(_comb(sorted(wheel_pool), picks))
        print()
        print(f"  Full wheel of {len(wheel_pool)} numbers = {len(combos):,} tickets.")
        if len(combos) > 200:
            print(f"  Warning: that\'s {len(combos):,} tickets — this may be expensive!")
        confirm = input("  Generate all? (Y/N): ").strip().upper()
        if confirm != "Y":
            print("  Wheel cancelled.")
            return []
        return [tuple(c) for c in combos]

    # ── Key-number wheel ──────────────────────────────────────────────────────
    # Pick the key number (must already be in pool)
    print()
    print(f"  Your wheel pool: {', '.join(str(n) for n in sorted(wheel_pool))}")
    print(f"  Choose one KEY number that will appear in every ticket.")
    while True:
        raw = input("  Key number: ").strip()
        if raw.isdigit() and int(raw) in wheel_pool:
            key = int(raw)
            break
        print(f"  Please enter a number from your pool.")

    from itertools import combinations as _comb
    rest = [n for n in wheel_pool if n != key]
    combos = [tuple(sorted([key] + list(c))) for c in _comb(rest, picks - 1)]
    print()
    print(f"  Key-number wheel: {key} fixed + "
          f"{picks-1} from remaining {len(rest)} = {len(combos):,} tickets.")
    confirm = input("  Generate all? (Y/N): ").strip().upper()
    if confirm != "Y":
        print("  Wheel cancelled.")
        return []
    return combos

# ── Save Results ───────────────────────────────────────────────────────────────

def save_results(game, sets, filters, dataset_label, output_file, locked_nums=None):
    timestamp    = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    picks        = game["picks"]
    fmt          = game["format"]

    # ── Plain-text log (original behaviour) ──────────────────────────────────
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

    # ── CSV export (new) ──────────────────────────────────────────────────────
    csv_file = output_file.replace(".txt", "_picks.csv")
    file_exists = os.path.exists(csv_file)
    with open(csv_file, "a", newline="", encoding="utf-8") as cf:
        writer = csv.writer(cf)
        if not file_exists:
            # Header row
            num_cols = [f"N{i}" for i in range(1, picks + 1)]
            extras   = [] if fmt == "pick" else ["Sum", "Spread", "Odds", "Evens"]
            writer.writerow(["Timestamp", "Game", "Dataset", "Set"] + num_cols + extras)
        for i, draw in enumerate(sets, 1):
            num_vals = list(draw)
            if fmt == "pick":
                extras = []
            else:
                odds   = sum(1 for n in draw if n % 2 != 0)
                extras = [sum(draw), max(draw) - min(draw), odds, picks - odds]
            writer.writerow([timestamp, game["name"], dataset_label, i] + num_vals + extras)

    return csv_file


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
    """Load draws for a game config. Returns (draws, draw_dates)."""
    if not game.get("csv"):
        return [], {}
    path = os.path.join(script_dir, game["csv"])
    if not os.path.exists(path):
        return [], {}
    print(f"\n  Loading {game['name']} data...")
    draws, draw_dates = load_csv(path, game["picks"], game["pool"], game["format"])
    return draws, draw_dates


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
    print("  [W] Wheel numbers")
    print("  [A] Add a custom game")
    print("  [Q] Quit")
    print()


def get_valid_choices(custom_games):
    choices = list(BUILTIN_GAMES.keys()) + list(custom_games.keys())
    choices += ["S","W","A","Q"]
    return choices


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    script_dir  = os.path.dirname(os.path.abspath(__file__))
    output_file = os.path.join(script_dir, "lotto_results.txt")
    draw_cache  = {}  # key -> (draws, draw_dates)

    def get_draws(key, game):
        if key not in draw_cache:
            draws, draw_dates = load_game_draws(game, script_dir)
            draw_cache[key] = (draws, draw_dates)
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

        # ── Add Custom Game ────────────────────────────────────────────────────
        if choice == "A":
            add_custom_game(script_dir)
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
            draws, draw_dates = get_draws(sc, game)

            if not draws:
                print(f"\n  No historical data for {game['name']}.")
                print("  Stats require historical draw data.")
                input("\n  Press Enter to return to the main menu...")
                continue

            active_draws, dataset_label = ask_dataset(draws, game["name"], draw_dates)
            if active_draws is None:
                active_draws = draws
                dataset_label = f"All {len(draws):,} draws"

            freq = build_frequency(active_draws, game["pool"], game["format"])
            print_stats(active_draws, freq, game, dataset_label)
            input("  Press Enter to return to the main menu...")
            continue

        # ── Wheel Numbers ──────────────────────────────────────────────────────
        if choice == "W":
            all_games = {**BUILTIN_GAMES, **custom_games}
            print("\n  Which game would you like to wheel for?")
            for k, g in all_games.items():
                print(f"  [{k}] {g['name']}")
            print()
            while True:
                wk = input("  Enter game key: ").strip().upper()
                if wk in all_games:
                    break
                print("  Please enter a valid game key.")

            game        = all_games[wk]
            wheel_sets  = ask_wheel(game, script_dir)

            if wheel_sets:
                print()
                print(f"  Generated {len(wheel_sets):,} wheeled ticket(s) for {game['name']}:")
                print("  " + "-" * 51)
                for i, draw in enumerate(wheel_sets, 1):
                    line = f"  Ticket {i:>4}: {format_draw(draw, game)}"
                    if game["format"] != "pick":
                        odds   = sum(1 for n in draw if n % 2 != 0)
                        spread = max(draw) - min(draw)
                        total  = sum(draw)
                        picks  = game["picks"]
                        line  += f"  (sum={total}, spread={spread}, {odds}o/{picks-odds}e)"
                    print(line)
                print("  " + "-" * 51)

                dummy_filters = {
                    "sum_min": 0, "sum_max": 9999,
                    "spread_min": 0, "spread_max": 999,
                    "odd_min": 0, "odd_max": game["picks"],
                }
                csv_out = save_results(game, wheel_sets, dummy_filters,
                                       "Wheel", output_file)
                print(f"\n  Results saved to : {output_file}")
                print(f"  CSV also saved to: {csv_out}")

            input("\n  Press Enter to return to the main menu...")
            continue

        # ── Generate Numbers ───────────────────────────────────────────────────
        all_games = {**BUILTIN_GAMES, **custom_games}
        game      = all_games[choice]
        draws, draw_dates = get_draws(choice, game)

        if not draws:
            print(f"\n  No historical data found for {game['name']}.")
            print("  Using pure probability (uniform weighting).")
            dataset_label = "Pure probability"
            active_draws  = None
        else:
            active_draws, dataset_label = ask_dataset(draws, game["name"], draw_dates)

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

            # Pass full draw history for never-appeared check
            history = active_draws if active_draws else (draws or [])
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

            csv_out = save_results(game, sets, filters, dataset_label, output_file, locked_nums)
            print(f"\n  Results saved to : {output_file}")
            print(f"  CSV also saved to: {csv_out}")

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
                # Re-ask dataset
                if draws:
                    active_draws, dataset_label = ask_dataset(draws, game["name"], draw_dates)
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
