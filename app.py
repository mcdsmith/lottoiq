from flask import Flask, jsonify, request
from flask_cors import CORS
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import lotto_generator as lotto

app = Flask(__name__)
CORS(app, origins=[
    "https://effortless-sprite-005d29.netlify.app",
    "https://lottoiq.ca",
    "http://localhost:3000",
    "http://localhost:5173"
])

@app.route("/health")
def health():
    return jsonify({"status": "ok", "message": "LottoIQ API is running"})

@app.route("/games")
def get_games():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    builtin, custom = lotto.get_all_games(script_dir)
    return jsonify({**builtin, **custom})

@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json() or {}
    
    game_key = data.get("game_key")
    num_sets = int(data.get("num_sets", 1))
    dataset_choice = data.get("dataset", "1")

    if not game_key:
        return jsonify({"error": "game_key is required"}), 400

    script_dir = os.path.dirname(os.path.abspath(__file__))
    builtin, custom = lotto.get_all_games(script_dir)
    all_games = {**builtin, **custom}

    if game_key not in all_games:
        return jsonify({"error": "Game not found"}), 404

    game = all_games[game_key]
    draws = lotto.load_game_draws(game, script_dir)

    # Select dataset
    if draws and dataset_choice != "4":
        if dataset_choice == "2":
            active_draws = draws[-90:] if len(draws) >= 90 else draws
            dataset_label = "Last 90 draws"
        elif dataset_choice == "3":
            active_draws = draws[-30:] if len(draws) >= 30 else draws
            dataset_label = "Last 30 draws"
        else:
            active_draws = draws
            dataset_label = f"All {len(draws):,} draws"
    else:
        active_draws = None
        dataset_label = "Pure probability"

    # Safe frequency
    if active_draws and len(active_draws) > 0:
        freq = lotto.build_frequency(active_draws, game["pool"], game["format"])
    else:
        freq = lotto.build_uniform_frequency(game["pool"], game["format"])

    # Safe ranges (avoid crashing get_filter_ranges)
    if active_draws and len(active_draws) > 0:
        try:
            ranges = lotto.get_filter_ranges(active_draws)
        except:
            ranges = {
                "sum_min": game["picks"] * 10,
                "sum_max": game["pool"] * game["picks"],
                "sum_low_max": 120,
                "sum_mid_min": 140,
                "sum_mid_max": 180,
                "sum_high_min": 200,
                "avg_sum": 150,
                "avg_spread": 25
            }
    else:
        ranges = {
            "sum_min": game["picks"] * 10,
            "sum_max": game["pool"] * game["picks"],
            "sum_low_max": 120,
            "sum_mid_min": 140,
            "sum_mid_max": 180,
            "sum_high_min": 200,
            "avg_sum": 150,
            "avg_spread": 25
        }

    # Safe filters
    filters = {
        "sum_min": ranges.get("sum_min", 0),
        "sum_max": ranges.get("sum_max", 999),
        "spread_min": 0,
        "spread_max": 999,
        "odd_min": 0,
        "odd_max": game.get("picks", 6),
        "never_appeared": False,
        "hl_choice": "A",
        "pool": game.get("pool", 49)
    }

    # Generate numbers
    sets = lotto.generate_numbers(
        freq=freq,
        game=game,
        filters=filters,
        num_sets=num_sets,
        locked_nums=[],
        draws=active_draws or draws
    )

    result = {
        "success": True,
        "game": game["name"],
        "game_key": game_key,
        "num_sets": num_sets,
        "dataset": dataset_label,
        "sets": [lotto.format_draw(s, game) for s in sets]
    }

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True, port=5000)