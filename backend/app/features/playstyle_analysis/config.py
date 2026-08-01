"""
Configuration for playstyle analysis service.

This module contains thresholds and parameters used to identify playstyle tags.
"""

from typing import Any, Dict

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
        "hover_template": "Gets First Blood in {value}% of games.",
        "display_name": "Aggressive Laner",
    },
    "passive_laner": {
        "min_first_blood_participation": 1,
        "max_percentage_matches": 20,
        "sentiment": "neutral",
        "hover_template": "Gets First Blood in {value}% of games.",
        "display_name": "Passive Laner",
    },
    "splitpusher": {
        "min_turret_kills": 2,
        "sentiment": "neutral",
        "hover_template": "Averages {value} turret kills per game.",
        "display_name": "Splitpusher",
    },
    "slayer": {
        "min_kills": 5,
        "sentiment": "positive",
        "hover_template": "Averages {value} kills per game.",
        "display_name": "Slayer",
    },
    "corpse": {
        "min_deaths": 5,
        "sentiment": "negative",
        "hover_template": "Averages {value} deaths per game.",
        "display_name": "Corpse",
    },
    "kda_player": {
        "min_kda": 2.5,
        "sentiment": "positive",
        "hover_template": "Averages {value} KDA per game.",
        "display_name": "KDA Player",
    },
    "colorblind": {
        "min_dead_time_ratio": 10,
        "sentiment": "negative",
        "hover_template": "Spends {value}% of game time dead.",
        "display_name": "Colorblind",
    },
    "potion_lover": {
        "min_potions": 2,
        "sentiment": "neutral",
        "hover_template": "Averages {value} potions purchased per game.",
        "display_name": "Potion Lover",
    },
    "warden": {
        "min_wards_placed": 8,
        "sentiment": "positive",
        "hover_template": "Averages {value} wards placed per game.",
        "display_name": "Warden",
    },
    "pentakiller": {
        "min_largest_multi_kill": 5,
        "percentage_matches": 1,
        "sentiment": "positive",
        "hover_template": "Averages {value} pentakills per game.",
        "display_name": "Pentakiller",
    },
    "healer": {
        "min_total_self_healing": 7000,
        "sentiment": "positive",
        "hover_template": "Heals {value} HP per game on average.",
        "display_name": "Healer",
    },
    "visionary": {
        "min_vision_score": 20,
        "sentiment": "positive",
        "hover_template": "Averages vision score {value} per game.",
        "display_name": "Visionary",
    },
    "champion_dps": {
        "min_total_damage_dealt_to_champions": 15000,
        "sentiment": "positive",
        "hover_template": "Averages {value} damage to champions per game.",
        "display_name": "Champion DPS",
    },
    "farmer": {
        "min_total_minions": 150,
        "sentiment": "neutral",
        "hover_template": "Averages {value} CS per game.",
        "display_name": "Farmer",
    },
    "good_at_farming": {
        "min_cs": 6.5,
        "sentiment": "positive",
        "hover_template": "Averages {value} CS per minute.",
        "display_name": "Good At Farming",
    },
    "bad_at_farming": {
        "max_cs": 5,
        "sentiment": "negative",
        "hover_template": "Averages {value} CS per minute.",
        "display_name": "Bad At Farming",
    },
    "assisting": {
        "min_assists": 8,
        "sentiment": "positive",
        "hover_template": "Averages {value} assists per game.",
        "display_name": "Assisting",
    },
    "fogmaker": {
        "min_wards_killed": 3,
        "sentiment": "positive",
        "hover_template": "Averages {value} ward kills per game.",
        "display_name": "Fogmaker",
    },
    "thief": {
        "min_objectives_stolen": 1,
        "percentage_matches": 1,
        "sentiment": "positive",
        "hover_template": "Averages {value} objective steals.",
        "display_name": "Thief",
    },
    "team_solo_kill": {
        "min_solo_kills": 1.5,
        "sentiment": "positive",
        "hover_template": "Averages {value} solo kills per game.",
        "display_name": "Team Solo Kill",
    },
    "resourceful": {
        "min_gold_per_minute": 400,
        "sentiment": "positive",
        "hover_template": "Averages {value} gold gain per minute.",
        "display_name": "Resourceful",
    },
    "roamin_n_slammin": {
        "min_roam_kills": 2,
        "sentiment": "positive",
        "hover_template": "Averages {value} roam kills per game.",
        "display_name": "Roamin'n'Slammin",
    },
    "camps_thief": {
        "min_enemy_jungle_monster_kills": 7,
        "sentiment": "positive",
        "hover_template": "Averages {value} enemy jungle camps steals.",
        "display_name": "Camps Thief",
    },
    "objective_dps": {
        "min_damage_dealt_to_objectives": 7000,
        "sentiment": "positive",
        "hover_template": "Averages {value} damage to objectives per game.",
        "display_name": "Objective DPS",
    },
    "plate_eater": {
        "min_turret_plates_taken": 2,
        "sentiment": "positive",
        "hover_template": "Averages {value} turret plates taken per game.",
        "display_name": "Plate Eater",
    },
    "lifesaver": {
        "min_ally_saves": 1,
        "sentiment": "positive",
        "hover_template": "Averages {value} allies saved from death per game.",
        "display_name": "Lifesaver",
    },
    "escape_artist": {
        "min_survived_single_digit_hp_count": 1,
        "sentiment": "neutral",
        "hover_template": "Survives with single digit HP {value} times per game.",
        "display_name": "Escape Artist",
    },
    "sniper": {
        "min_skillshots_hit": 30,
        "sentiment": "positive",
        "hover_template": "Averages {value} skillshots hit per game.",
        "display_name": "Sniper",
    },
    "ninja": {
        "min_skillshots_dodged": 35,
        "sentiment": "positive",
        "hover_template": "Averages {value} skillshots dodged per game.",
        "display_name": "Ninja",
    },
    "team_player": {
        "min_kill_participation": 50,
        "sentiment": "positive",
        "hover_template": "Averages {value}% of team kills participation.",
        "display_name": "Team Player",
    },
    "golden_leader": {
        "type": "gold_diff_check",
        "min_lane_gold_lead": 1000,
        "sentiment": "positive",
        "hover_template": "Averages {value} gold lead over lane opponent.",
        "display_name": "Golden Leader",
    },
    "front_line": {
        "min_team_damage_taken_pct": 25,
        "sentiment": "neutral",
        "hover_template": "Averages {value}% of team's damage taken per game.",
        "display_name": "Front Line",
    },
    "stunning": {
        "min_enemy_immobilizations": 18,
        "sentiment": "positive",
        "hover_template": "Averages {value} enemy immobilizations per game.",
        "display_name": "Stunning",
    },
    "going_in": {
        "min_kills_near_enemy_turret": 1,
        "sentiment": "positive",
        "hover_template": "Averages {value} kills under enemy turrets per game.",
        "display_name": "Going In",
    },
    "give_me_those": {
        "min_buffs_stolen": 1,
        "sentiment": "positive",
        "hover_template": "Averages {value} buffs steals from enemies per game.",
        "display_name": "Give Me Those",
    },
    "heavy_hitter": {
        "min_team_damage_pct": 28,
        "sentiment": "positive",
        "hover_template": "Averages {value}% of team's damage per game.",
        "display_name": "Heavy Hitter",
    },
    "a_money_well_spent": {
        "min_vision_wards_bought": 2,
        "sentiment": "positive",
        "hover_template": "Averages {value} control ward purchases per game.",
        "display_name": "A Money Well Spent",
    },
    "epic_thief": {
        "min_epic_monster_steals": 1,
        "percentage_matches": 5,
        "sentiment": "positive",
        "hover_template": "Averages {value} epic monster steals.",
        "display_name": "Epic Thief",
    },
    # ----------------------------------------------------
    # Comparison / Type Tags
    # ----------------------------------------------------
    "warrior": {
        "type": "damage_type",
        "target": "physical",
        "percentage_matches": 60,
        "sentiment": "neutral",
        "hover_template": "{value}% of all damage dealt is physical.",
        "display_name": "Warrior",
    },
    "wizard": {
        "type": "damage_type",
        "target": "magic",
        "percentage_matches": 60,
        "sentiment": "neutral",
        "hover_template": "{value}% of all damage dealt is magic.",
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
        "min_play_rate": 80,
        "sentiment": "neutral",
        "hover_template": "Plays {champion} in {value}% of games.",
        "display_name": "{champion} OTP",
    },
    "main_champion": {
        "min_play_rate": 50,
        "sentiment": "neutral",
        "hover_template": "Plays {champion} in {value}% of games.",
        "display_name": "{champion} Main",
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
        "hover_template": "Surrenders {value}% of games.",
        "display_name": "Never Surrender",
    },
    "ff15": {
        "type": "surrender_check",
        "check": "often",
        "sentiment": "negative",
        "hover_template": "Surrenders {value}% of games.",
        "display_name": "FF15",
    },
    # ----------------------------------------------------
    # Negation / Complementary Tags
    # ----------------------------------------------------
    "resourceless": {
        "max_gold_per_minute": 350,
        "sentiment": "negative",
        "hover_template": "Averages {value} gold gain per minute.",
        "display_name": "Resourceless",
    },
    "golden_deficiter": {
        "type": "gold_diff_check",
        "check_deficit": True,
        "min_lane_gold_deficit": 1000,
        "sentiment": "negative",
        "hover_template": "Averages {value} gold deficit to lane opponent.",
        "display_name": "Golden Deficiter",
    },
    "solo_player": {
        "max_kill_participation": 30,
        "sentiment": "negative",
        "hover_template": "Averages {value}% of team kills participation.",
        "display_name": "Solo Player",
    },
    "takes_all_kills": {
        "type": "kill_greed_check",
        "min_kill_assist_ratio": 4.0,
        "percentage_matches": 40,
        "sentiment": "negative",
        "hover_template": "Non-solo kills to assists ratio: {value}:1.",
        "display_name": "Takes All Kills",
    },
    "blind": {
        "max_vision_score": 20,
        "sentiment": "negative",
        "hover_template": "Averages vision score {value} per game.",
        "display_name": "Blind",
    },
    "back_line": {
        "max_team_damage_taken_pct": 18,
        "sentiment": "neutral",
        "hover_template": "Averages {value}% of team's damage taken per game.",
        "display_name": "Back Line",
    },
    "duelist": {
        "type": "solo_kill_ratio_check",
        "min_solo_kill_assist_ratio": 4.0,
        "percentage_matches": 30,
        "sentiment": "positive",
        "hover_template": "Solo kills to assists ratio: {value}:1.",
        "display_name": "Duelist",
    },
    "ignores_objectives": {
        "type": "objective_participation_check",
        "max_objective_damage_pct": 10,
        "percentage_matches": 40,
        "sentiment": "negative",
        "hover_template": "Averages {value}% of team's objective damage.",
        "display_name": "Ignores Objectives",
    },
}
