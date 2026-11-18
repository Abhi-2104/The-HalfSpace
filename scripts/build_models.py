#!/usr/bin/env python3
"""Rebuild everything derived from the cached raw data, in dependency order:
raw JSON -> data/derived/*.pkl -> models (data/models/) + serving tables (data/derived.db).

  python3 scripts/build_models.py            # all
  python3 scripts/build_models.py xg xt      # just these (names below); run `derive` first after new ingests

Run after scripts/refresh_data.py brings in new matches. A few minutes on a 16-core machine.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from halfspace import derive
from halfspace.models import goalkeeper, momentum, passframes, possessions, profiles, roles, search, style, tracking, vaep, xg, xpass, xt

STEPS = {"derive": derive.build, "xg": xg.train, "momentum": momentum.train, "xt": xt.train, "profiles": profiles.train, "possessions": possessions.train, "style": style.train,
         "xpass": xpass.train, "passframes": passframes.train, "goalkeeper": goalkeeper.train, "roles": roles.train, "vaep": vaep.train, "tracking": tracking.train, "search": search.build}


def main():
    wanted = sys.argv[1:] or list(STEPS)
    for name in wanted:
        if name not in STEPS:
            sys.exit(f"unknown step '{name}'; steps: {', '.join(STEPS)}")
    for name in [s for s in STEPS if s in wanted]:  # always dependency order
        t = time.time()
        result = STEPS[name]()
        summary = result if name == "derive" else {k: result[k] for k in ("oof_metrics", "sanity", "n_player_seasons") if k in result}
        print(f"{name}: {time.time() - t:.0f}s {summary}")


if __name__ == "__main__":
    main()
