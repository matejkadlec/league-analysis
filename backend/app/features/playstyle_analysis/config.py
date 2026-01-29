"""
Configuration for playstyle analysis service.

This module contains thresholds and parameters used to identify playstyle tags.
"""

from typing import Dict, Any

# Tag Configuration
# Each tag has specific parameters used in its formula.
TAG_CONFIG: Dict[str, Dict[str, float]] = {
    # ----------------------------------------------------
    # Match-Based Condition Tags
    # ----------------------------------------------------
    # Condition: Player achieves {metric} in >= {percentage_matches}% of games
    "aggresive_laner": {
        "min_first_blood_rate": 20.0,  # Got First Blood in 20% of games
    },
    "passive_laner": {
        "max_first_blood_rate": 5.0,  # Got First Blood in <= 5% of games
    },
    "splitpusher": {
        "min_turret_kills": 2.0,  # At least 2 turrets
        "percentage_matches": 30.0,  # In 30% of games
    },
    "slayer": {
        "min_kills": 10.0,  # At least 10 kills
        "percentage_matches": 30.0,  # In 30% of games
    },
    "corpse": {
        "min_deaths": 8.0,  # At least 8 deaths
        "percentage_matches": 30.0,  # In 30% of games
    },
    "kda_player": {
        "min_kda": 4.0,  # KDA > 4.0
        "percentage_matches": 40.0,  # In 40% of games
    },
    "colorblind": {
        "min_dead_time_ratio": 20.0,  # Spent > 20% of game time dead
        "percentage_matches": 20.0,  # In 20% of games
    },
    "potion_lover": {
        "min_potions": 3.0,  # Purchased > 3 potions (consumables - pinks)
        "percentage_matches": 40.0,  # In 40% of games
    },
    "warden": {
        "min_wards_placed": 12.0,  # Placed > 12 wards
        "percentage_matches": 50.0,  # In 50% of games
    },
    "pentakiller": {
        "min_pentakills": 1.0,  # Got a pentakill
        "percentage_matches": 1.0,  # In >= 1% of games (basically "has happened recently")
    },
    "warrior": {
        # Condition: Phys Damage > Magic Damage in X% games
        "percentage_matches": 60.0,
    },
    "wizard": {
        # Condition: Magic Damage > Phys Damage in X% games
        "percentage_matches": 60.0,
    },
    # ----------------------------------------------------
    # Global/Aggregate Tags
    # ----------------------------------------------------
    "nolifer": {
        "min_summoner_level": 400.0,
    },
    "prefers_blue_side": {
        "winrate_diff_threshold": 5.0,  # wins blue > wins red by 5%
    },
    "prefers_red_side": {
        "winrate_diff_threshold": 5.0,  # wins red > wins blue by 5%
    },
    "otp": {
        "min_play_rate": 70.0,  # Played champion in 70% of games
    },
    "main_role": {
        "min_role_rate": 50.0,  # Played role in 50% of games
    },
    # ----------------------------------------------------
    # Additional Tags (Simple Stats)
    # ----------------------------------------------------
    "healer": {"min_healing": 10000.0, "percentage_matches": 30.0},
    "all_seeing": {"min_vision_score": 40.0, "percentage_matches": 30.0},
    "dps": {"min_damage_dealt": 25000.0, "percentage_matches": 30.0},
    "farmer": {
        # Condition: Total Damage Dealt (to minions etc) > 5 * Damage to Champs
        # Using simple ratio check
        "pve_pvp_ratio": 6.0,
        "percentage_matches": 40.0,
    },
    "scaling": {
        # Win rate in long games (> 30 min)
        "min_game_time_minutes": 30.0,
        "min_win_rate": 60.0,
    },
    "assisting": {"min_assists": 12.0, "percentage_matches": 40.0},
    "fogmaker": {"min_wards_killed": 4.0, "percentage_matches": 30.0},
    "theft": {
        "min_objectives_stolen": 1.0,
        "percentage_matches": 1.0,  # Happened at least once/twice
    },
}
