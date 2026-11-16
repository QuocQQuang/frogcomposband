#!/usr/bin/env python3
"""
parse_monsters.py
Parses FrogComposband lib/edit/r_info.txt and outputs monsters.csv
"""

import csv
import os
import re
import sys

INPUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'lib', 'edit', 'r_info.txt')
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'monsters.csv')

# ── Field reference ──────────────────────────────────────────────────────────
# N: id : name
# G: symbol : color
# I: speed : hp_dice : vision : ac : alertness : weight
# W: depth : rarity : max_depth : exp : next_exp : next_mon
# B: method : effect(dice)   (up to 4 lines)
# S: spell lines (freq + spell names)
# F: flag lines
# D: description lines
# A: aura lines
# O: object drop lines
# P: possessor lines


COLOR_MAP = {
    'D': 'Black',       'w': 'White',        's': 'Gray',         'o': 'Orange',
    'r': 'Red',         'g': 'Green',         'b': 'Blue',         'u': 'Brown',
    'd': 'Dark Gray',   'W': 'Light Gray',    'v': 'Violet',       'y': 'Yellow',
    'R': 'Light Red',   'G': 'Light Green',   'B': 'Light Blue',   'U': 'Light Brown',
    'L': 'Int. Green',  'P': 'Pink',          'I': 'Int. Blue',    'C': 'Purple',
    't': 'Teal',        'S': 'Sky-Blue',      'm': 'Mud',          'M': 'Dark Yellow',
    'T': 'Turquoise',   'O': 'Light Orange',  'V': 'Lilac',        'c': 'Dark Purple',
    'n': 'Dark Sky',    'K': 'Pale Blue',     'p': 'Dark Pink',    'h': 'Chestnut',
}

FIELDNAMES = [
    'id', 'name',
    'symbol', 'color',
    'speed', 'hp_dice', 'vision', 'ac', 'alertness', 'weight_lbs',
    'depth', 'rarity', 'max_depth', 'exp', 'next_exp', 'next_mon',
    'blow1', 'blow2', 'blow3', 'blow4',
    'aura',
    'spell_freq', 'spells',
    'flags',
    'object_drops',
    'description',
    'is_unique',
]


def parse_r_info(path: str):
    monsters = []
    current = None

    def flush():
        if current:
            monsters.append(current)

    with open(path, encoding='latin-1') as f:
        for raw_line in f:
            line = raw_line.rstrip('\r\n')

            # Skip comments and blank lines
            if not line or line.startswith('#'):
                continue

            prefix = line[:2]
            rest = line[2:].strip() if len(line) > 2 else ''

            if prefix == 'N:':
                flush()
                parts = rest.split(':', 1)
                mid = int(parts[0]) if parts[0].isdigit() else 0
                name = parts[1] if len(parts) > 1 else ''
                current = {
                    'id': mid, 'name': name,
                    'symbol': '', 'color': '',
                    'speed': '', 'hp_dice': '', 'vision': '', 'ac': '', 'alertness': '', 'weight_lbs': '',
                    'depth': '', 'rarity': '', 'max_depth': '', 'exp': '', 'next_exp': '', 'next_mon': '',
                    'blow1': '', 'blow2': '', 'blow3': '', 'blow4': '',
                    'aura': '',
                    'spell_freq': '', 'spells': '',
                    'flags': '',
                    'object_drops': '',
                    'description': '',
                    'is_unique': 'No',
                }

            elif prefix == 'G:' and current is not None:
                parts = rest.split(':')
                current['symbol'] = parts[0] if parts else ''
                color_code = parts[1] if len(parts) > 1 else ''
                current['color'] = COLOR_MAP.get(color_code, color_code)

            elif prefix == 'I:' and current is not None:
                parts = rest.split(':')
                fields = ['speed', 'hp_dice', 'vision', 'ac', 'alertness', 'weight_lbs']
                for i, f in enumerate(fields):
                    current[f] = parts[i] if i < len(parts) else ''

            elif prefix == 'W:' and current is not None:
                parts = rest.split(':')
                fields = ['depth', 'rarity', 'max_depth', 'exp', 'next_exp', 'next_mon']
                for i, f in enumerate(fields):
                    current[f] = parts[i] if i < len(parts) else ''

            elif prefix == 'B:' and current is not None:
                # Find first empty blow slot
                blow_str = rest.replace(':', ' ')
                for slot in ['blow1', 'blow2', 'blow3', 'blow4']:
                    if not current[slot]:
                        current[slot] = blow_str
                        break

            elif prefix == 'A:' and current is not None:
                aura = rest.replace(':', ' ')
                if current['aura']:
                    current['aura'] += ' | ' + aura
                else:
                    current['aura'] = aura

            elif prefix == 'S:' and current is not None:
                # S:1_IN_X or S:FREQ_NN is spell frequency; rest are spell names
                parts = [p.strip() for p in rest.split('|') if p.strip()]
                for p in parts:
                    if p.startswith('1_IN_') or p.startswith('FREQ_'):
                        current['spell_freq'] = p
                    else:
                        if current['spells']:
                            current['spells'] += ' | ' + p
                        else:
                            current['spells'] = p

            elif prefix == 'F:' and current is not None:
                flags = [p.strip() for p in rest.split('|') if p.strip()]
                for flag in flags:
                    if flag == 'UNIQUE':
                        current['is_unique'] = 'Yes'
                    if current['flags']:
                        current['flags'] += ' | ' + flag
                    else:
                        current['flags'] = flag

            elif prefix == 'O:' and current is not None:
                if current['object_drops']:
                    current['object_drops'] += ' | ' + rest
                else:
                    current['object_drops'] = rest

            elif prefix == 'D:' and current is not None:
                desc = rest.strip()
                if current['description']:
                    current['description'] += ' ' + desc
                else:
                    current['description'] = desc

            # P: (possessor) lines are intentionally skipped for the CSV
            # as they are complex and less useful for a standard monster reference.

    flush()
    return monsters


def write_csv(monsters, path: str):
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(monsters)
    print(f"Written {len(monsters)} monsters to: {path}")


def main():
    input_path = os.path.abspath(INPUT_FILE)
    output_path = os.path.abspath(OUTPUT_FILE)

    if not os.path.exists(input_path):
        print(f"ERROR: Cannot find {input_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Parsing {input_path} ...")
    monsters = parse_r_info(input_path)
    print(f"  Found {len(monsters)} monsters")
    write_csv(monsters, output_path)


if __name__ == '__main__':
    main()
