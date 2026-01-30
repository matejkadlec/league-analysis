"""
Configuration for playstyle analysis service.

This module contains thresholds and parameters used to identify playstyle tags.
"""

from typing import Dict, Any

# Tag Configuration
# Each tag has specific parameters used in its formula.
TAG_CONFIG: Dict[str, Dict[str, Any]] = {
    # ----------------------------------------------------
    # Match-Based Condition Tags
    # ----------------------------------------------------
    "aggresive_laner": {
        "min_first_blood_participation": 1,
        "percentage_matches": 20,
        "sentiment": "neutral",
        "hover_template": "Got First Blood in {value}% of games.",
        "display_name": "Aggressive Laner",
    },
    "passive_laner": {
        "max_first_blood_participation": 0,
        "percentage_matches": 80,
        "sentiment": "neutral",
        "hover_template": "No First Blood in {value}% of games.",
        "display_name": "Passive Laner",
    },
    "splitpusher": {
        "min_turret_kills": 2,
        "percentage_matches": 25,
        "sentiment": "neutral",
        "hover_template": "Averages {value} turret kills per game.",
        "display_name": "Splitpusher",
    },
    "slayer": {
        "min_kills": 8,
        "percentage_matches": 30,
        "sentiment": "positive",
        "hover_template": "Averages {value} kills per game.",
        "display_name": "Slayer",
    },
    "corpse": {
        "min_deaths": 7,
        "percentage_matches": 30,
        "sentiment": "negative",
        "hover_template": "Averages {value} deaths per game.",
        "display_name": "Corpse",
    },
    "kda_player": {
        "min_kda": 3,
        "percentage_matches": 40,
        "sentiment": "positive",
        "hover_template": "Maintains {value} KDA average.",
        "display_name": "KDA Player",
    },
    "colorblind": {
        "min_dead_time_ratio": 15,
        "percentage_matches": 20,
        "sentiment": "negative",
        "hover_template": "Spends {value}% of game time dead.",
        "display_name": "Colorblind",
    },
    "potion_lover": {
        "min_potions": 3,
        "percentage_matches": 30,
        "sentiment": "neutral",
        "hover_template": "Buys {value} potions per game on average.",
        "display_name": "Potion Lover",
    },
    "warden": {
        "min_wards_placed": 12,
        "percentage_matches": 50,
        "sentiment": "positive",
        "hover_template": "Places {value} wards per game on average.",
        "display_name": "Warden",
    },
    "pentakiller": {
        "min_pentakills": 1,
        "percentage_matches": 1,
        "sentiment": "positive",
        "hover_template": "Has {value} pentakills in recent games.",
        "display_name": "Pentakiller",
    },
    "healer": {
        "min_healing": 10000,
        "percentage_matches": 25,
        "sentiment": "positive",
        "hover_template": "Heals {value} damage per game on average.",
        "display_name": "Healer",
    },
    "all_seeing": {
        "min_vision_score": 30,
        "percentage_matches": 40,
        "sentiment": "positive",
        "hover_template": "Average vision score of {value}.",
        "display_name": "All-Seeing",
    },
    "damage_dealer": {
        "min_damage_champions": 20000,
        "percentage_matches": 30,
        "sentiment": "positive",
        "hover_template": "Averages {value} damage to champions per game.",
        "display_name": "Damage Dealer",
    },
    "farmer": {
        "min_cs": 7,
        "min_total_minions": 180,
        "percentage_matches": 30,
        "sentiment": "neutral",
        "hover_template": "Averages {value} CS per game.",
        "display_name": "Farmer",
    },
    "assisting": {
        "min_assists": 12,
        "percentage_matches": 30,
        "sentiment": "positive",
        "hover_template": "Averages {value} assists per game.",
        "display_name": "Assisting",
    },
    "fogmaker": {
        "min_wards_killed": 4,
        "percentage_matches": 30,
        "sentiment": "positive",
        "hover_template": "Destroys {value} wards per game.",
        "display_name": "Fogmaker",
    },
    "theft": {
        "min_objectives_stolen": 1,
        "percentage_matches": 1,
        "sentiment": "positive",
        "hover_template": "Stole {value} objectives.",
        "display_name": "Theft",
    },
    # ----------------------------------------------------
    # Comparison / Type Tags
    # ----------------------------------------------------
    "warrior": {
        "type": "damage_type",
        "target": "physical",
        "percentage_matches": 60,
        "sentiment": "neutral",
        "hover_template": "Deals mostly physical damage.",
        "display_name": "Warrior",
    },
    "wizard": {
        "type": "damage_type",
        "target": "magic",
        "percentage_matches": 60,
        "sentiment": "neutral",
        "hover_template": "Deals mostly magic damage.",
        "display_name": "Wizard",
    },
    "prefers_blue_side": {
        "type": "side_preference",
        "target": 100,
        "sentiment": "neutral",
        "hover_template": "Higher winrate on Blue Side ({value}%).",
        "display_name": "Prefers Blue Side",
    },
    "prefers_red_side": {
        "type": "side_preference",
        "target": 200,
        "sentiment": "neutral",
        "hover_template": "Higher winrate on Red Side ({value}%).",
        "display_name": "Prefers Red Side",
    },
    # ----------------------------------------------------
    # Global / Special Tags
    # ----------------------------------------------------
    "nolifer": {
        "min_summoner_level": 500,
        "sentiment": "neutral",
        "hover_template": "Summoner Level {value}.",
        "display_name": "No-Lifer",
    },
    "otp": {
        "min_play_rate": 70,
        "sentiment": "neutral",
        "hover_template": "Plays {champion} in {value}% of games.",
        "display_name": "{champion} OTP",
    },
    "main_role": {
        "min_play_rate": 50,
        "sentiment": "neutral",
        "hover_template": "Plays {role} in {value}% of games.",
        "display_name": "{role} Main",
    },
    "never_surrender": {
        "type": "surrender_check",
        "check": "never",
        "sentiment": "positive",
        "hover_template": "Rarely surrenders games.",
        "display_name": "Never Surrender",
    },
    "ff15": {
        "type": "surrender_check",
        "check": "often",
        "sentiment": "negative",
        "hover_template": "Often attempts to surrender early.",
        "display_name": "FF15",
    },
}
