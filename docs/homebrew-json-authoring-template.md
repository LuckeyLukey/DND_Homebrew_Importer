# D&D Beyond Homebrew Importer JSON Vorlage

Diese Vorlage ist fuer Codex in einem Obsidian Vault gedacht. Wenn Codex ein D&D Beyond Homebrew JSON fuer den Importer erzeugen soll, verwende diese Datei als verbindliche Spezifikation.

Ziel: Erzeuge ausschliesslich valides JSON, das lokal im Chrome Add-on **D&D Beyond Homebrew Importer** verwendet werden kann. Keine Markdown-Codezaeune im finalen JSON, keine Kommentare im JSON, keine zusaetzlichen Erklaertexte.

## Codex Arbeitsanweisung

Wenn du aus Kampagnen-Notizen ein Homebrew fuer den Importer generierst:

1. Entscheide zuerst, ob das Ziel ein Magic Item oder ein Spell ist.
2. Waehle fuer Magic Items genau einen `type`-Wert: `weapon`, `armor` oder `item`.
3. Waehle fuer Homebrew Spells `type: "spell"`.
4. Nutze nur Felder aus dieser Vorlage.
5. Lasse unbekannte oder nicht passende optionale Felder weg, statt sie mit Platzhaltern zu fuellen.
6. Gib Booleans als echte Booleans aus: `true` oder `false`, nicht als String.
7. Gib Zahlen als echte Zahlen aus: `1`, nicht `"1"`, ausser ein D&D-Beyond-Feld erwartet bewusst Text.
8. Gib Arrays immer als Arrays aus, auch bei nur einem Eintrag.
9. Verwende fuer Dropdown-Werte sichtbare D&D-Beyond-Labels, z. B. `Rare`, `Longsword`, `Evocation`, `Action`, `Long Rest`.
10. Erzeuge keine kampagnenspezifischen Feldnamen wie `ashOfWar`. Kampagnenspezifische Faehigkeiten gehoeren in `actions` oder in die `description`.
11. Das Add-on speichert die Hauptseite nie automatisch. Erzeuge trotzdem vollstaendige Daten fuer Erstimport und zweiten Edit-Import.
12. Schreibe optionale Zahlenfelder nicht mit `0`, wenn sie keine Wirkung haben. Lasse sie weg. Beispiele: kein `duration: 0`, kein `fixedValue: 0`, kein `diceCount: 0`.

## Minimaler Magic-Item-Import

```json
{
  "type": "weapon",
  "name": "Example Longsword",
  "baseWeapon": "Longsword",
  "rarity": "Rare",
  "requiresAttunement": false,
  "description": "A concise item description.",
  "notes": "Private creator notes."
}
```

## Vollstaendige Magic-Item-Struktur

Nutze diese Struktur fuer Waffen, Ruestungen und generische Magic Items. Entferne Felder, die nicht passen.

```json
{
  "type": "weapon",
  "name": "Example Magic Item",
  "version": "A",
  "rarity": "Rare",
  "requiresAttunement": true,
  "attunementDescription": "creature proficient with this item",
  "baseWeapon": "Longsword",
  "baseArmor": "Plate",
  "magicItemType": "Wondrous Item",
  "dexBonus": "Yes",
  "strengthRequirement": "15",
  "stealthCheck": "Disadvantage",
  "damage": {
    "dice": "1d8",
    "type": "Slashing"
  },
  "properties": [
    "Versatile"
  ],
  "description": "Full public item description. Include all rules text that a player should read.",
  "notes": "Private note for the homebrew editor.",
  "tags": [
    "Weapon",
    "Melee",
    "Homebrew"
  ],
  "actions": [
    {
      "name": "Example Feature",
      "activation": "Action",
      "uses": 1,
      "reset": "Long Rest",
      "description": "Rules text for the feature. This text is included in the item description."
    }
  ],
  "modifiers": [
    {
      "type": "Bonus",
      "subType": "Melee Weapon Attacks",
      "value": 1,
      "abilityScore": "",
      "dieType": "",
      "additionalBonusTypes": [],
      "details": "The item grants a +1 bonus to melee weapon attacks.",
      "durationUnit": "",
      "requiresAttunement": false
    }
  ],
  "conditions": [
    {
      "condition": "Frightened",
      "duration": 1,
      "durationUnit": "Round",
      "details": "A target can be frightened until the end of its next turn."
    }
  ],
  "spells": [
    {
      "name": "Shield",
      "minCharges": 1,
      "maxCharges": 1,
      "saveDc": 16,
      "castAtLevel": "1st",
      "details": "You can expend 1 charge to cast Shield from the item without material components."
    }
  ]
}
```

## Magic-Item Feldregeln

- `type`: `weapon`, `armor` oder `item`.
- `name`: Pflichtfeld.
- `version`: Optionaler D&D-Beyond-Versionstext, z. B. `A`, `1`, `1.1`.
- `rarity`: Sichtbares D&D-Beyond-Label, z. B. `Common`, `Uncommon`, `Rare`, `Very Rare`, `Legendary`, `Artifact`, `Varies`, `Unknown Rarity`.
- `requiresAttunement`: Boolean. Wenn `true`, setze auch `attunementDescription`.
- `attunementDescription`: Nur die Zielgruppe schreiben. D&D Beyond setzt automatisch Text davor. Gut: `wizard`, `creature proficient with longswords`. Schlecht: `requires attunement by a wizard`.
- `baseWeapon`: Nur fuer `type: "weapon"`, z. B. `Longsword`, `Dagger`, `Quarterstaff`, `Greatsword`, `Rapier`.
- `baseArmor`: Nur fuer `type: "armor"`, z. B. `Leather`, `Chain Mail`, `Plate`, `Shield`.
- `magicItemType`: Vor allem fuer `type: "item"`, z. B. `Wondrous Item`, `Ring`, `Rod`, `Staff`, `Wand`, `Potion`, `Scroll`.
- `damage` und `properties`: Werden bei Magic Items in die Description aufgenommen, wenn D&D Beyond keine eigenen Felder anbietet.
- `actions`: Generische Features, Aktivierungen oder kampagnenspezifische Skills. Keine Sonderfelder erfinden.
- `modifiers`, `conditions`, `spells`: Werden auf separaten D&D-Beyond-Unterseiten angelegt. Der Importer kann diese Unterseiten optional automatisch oeffnen und speichern.

## Minimaler Spell-Import

```json
{
  "type": "spell",
  "name": "Example Spell",
  "version": "A",
  "spellLevel": "1st",
  "school": "Evocation",
  "castingTime": {
    "amount": 1,
    "unit": "Action"
  },
  "components": ["V", "S"],
  "range": {
    "type": "Ranged",
    "distance": 60
  },
  "duration": {
    "type": "Instantaneous"
  },
  "description": "A concise spell description.",
  "classes": ["Wizard"]
}
```

## Vollstaendige Spell-Struktur

Nutze diese Struktur fuer Homebrew Spells. Entferne Felder, die nicht passen.

```json
{
  "type": "spell",
  "name": "Example Spell",
  "version": "A",
  "spellLevel": "3rd",
  "school": "Evocation",
  "castingTime": {
    "amount": 1,
    "unit": "Reaction",
    "reactionDescription": "When a creature you can see within range takes damage."
  },
  "components": ["V", "S", "M"],
  "materialDescription": "a polished crystal worth at least 25 gp",
  "range": {
    "type": "Ranged",
    "distance": 60
  },
  "duration": {
    "type": "Concentration",
    "amount": 1,
    "unit": "Minute"
  },
  "description": "Full public spell description. Include attack rolls, saving throws, damage, conditions, and scaling text.",
  "ritual": false,
  "atHigherLevelsScaling": true,
  "higherLevelScale": "Spell Scale",
  "classes": [
    "Cleric",
    "Paladin",
    "Wizard"
  ],
  "areaOfEffect": {
    "type": "Sphere",
    "size": 10,
    "special": false,
    "description": ""
  },
  "attackType": "Ranged",
  "saveType": "Wisdom",
  "effectOnMiss": "The spell has no effect on a miss.",
  "effectOnSaveSuccess": "The target takes half damage and suffers no condition.",
  "effectOnSaveFail": "The target takes full damage and suffers the listed condition.",
  "spellEffectTags": [
    "Damage",
    "Radiant"
  ],
  "spellModifiers": [
    {
      "type": "Damage",
      "subType": "Radiant",
      "diceCount": 6,
      "dieType": "d6",
      "durationUnit": "",
      "usePrimaryStat": false,
      "details": "Radiant damage dealt by the spell."
    }
  ],
  "spellConditions": [
    {
      "effect": "Apply",
      "condition": "Blinded",
      "duration": 1,
      "durationUnit": "Round",
      "details": "On a failed save, the target is blinded until the end of its next turn."
    }
  ],
  "higherLevels": [
    {
      "level": 1,
      "modifier": "Damage - Radiant",
      "effect": "Additional Points",
      "diceCount": 1,
      "dieType": "d6",
      "details": "Damage increases by 1d6 for each spell slot level above 3rd."
    }
  ]
}
```

## Spell Feldregeln

- `type`: Muss fuer Spells `spell` sein.
- `spellLevel`: Sichtbares D&D-Beyond-Label, z. B. `Cantrip`, `1st`, `2nd`, `3rd`, `4th`, `5th`, `6th`, `7th`, `8th`, `9th`.
- `school`: Sichtbares Label, z. B. `Abjuration`, `Conjuration`, `Divination`, `Enchantment`, `Evocation`, `Illusion`, `Necromancy`, `Transmutation`.
- `castingTime.unit`: Z. B. `Action`, `Bonus Action`, `Reaction`, `Minute`, `Hour`.
- `castingTime.reactionDescription`: Nur setzen, wenn `unit` `Reaction` ist.
- `components`: Kombination aus `V`, `S`, `M`.
- `materialDescription`: Setzen, wenn `components` `M` enthaelt.
- `range.type`: Sichtbares Label wie `Self`, `Touch`, `Ranged`, `Sight`, `Unlimited`.
- `range.distance`: Zahl in ft, wenn das D&D-Beyond-Feld eine Distanz erwartet.
- `duration.type`: Sichtbares Label wie `Instantaneous`, `Concentration`, `Time`, `Until Dispelled`.
- `duration.amount` und `duration.unit`: Fuer zeitbasierte oder Konzentrationsdauer setzen, z. B. `1` und `Minute`.
- `ritual`: Boolean.
- `atHigherLevelsScaling`: Boolean. Wenn `true`, sollte `higherLevels` Eintraege enthalten.
- `higherLevelScale`: Meist `Spell Scale`.
- `classes`: Sichtbare Klassennamen, z. B. `Artificer`, `Bard`, `Cleric`, `Druid`, `Paladin`, `Ranger`, `Sorcerer`, `Warlock`, `Wizard`.
- `areaOfEffect.type`: Z. B. `Cone`, `Cube`, `Cylinder`, `Line`, `Sphere`.
- `attackType`: Z. B. `Melee`, `Ranged` oder leer lassen, wenn der Spell keinen Angriffswurf nutzt.
- `saveType`: Z. B. `Strength`, `Dexterity`, `Constitution`, `Intelligence`, `Wisdom`, `Charisma` oder leer lassen.
- `spellModifiers`: Unterseiten-Eintraege fuer mechanische Effekte.
- Bei `spellModifiers`, `modifiers` und `higherLevels` optionale Zahlenfelder mit Wert `0` weglassen. D&D Beyond validiert einige dieser Felder mit Mindestwert `1`.
- `spellConditions.effect`: Einer von `Apply`, `Remove`, `Suppress`.
- `higherLevels.effect`: D&D-Beyond-Scale-Effect. Gueltige Werte: `Additional Count`, `Additional Creatures`, `Additional Points`, `Additional Targets`, `Extended Area`, `Extended Duration`, `Extended Range`, `Special`.
- Fuer zusaetzliche Schadens- oder Heilwuerfel bei `higherLevels` verwende `effect: "Additional Points"` zusammen mit `diceCount` und `dieType`.

## Gueltige haeufige Werte

### Reset Conditions

```json
["Short Rest", "Long Rest", "Dawn", "Dusk"]
```

### Damage Types

```json
["Acid", "Bludgeoning", "Cold", "Fire", "Force", "Lightning", "Necrotic", "Piercing", "Poison", "Psychic", "Radiant", "Slashing", "Thunder"]
```

### Weapon Properties

```json
["Ammunition", "Finesse", "Heavy", "Light", "Loading", "Range", "Reach", "Thrown", "Two-Handed", "Versatile"]
```

### Conditions

```json
["Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious"]
```

### Die Types

```json
["d4", "d6", "d8", "d10", "d12", "d20"]
```

## Qualitaetscheck vor Ausgabe

Codex muss vor der finalen Ausgabe pruefen:

- Ist das Ergebnis valides JSON?
- Gibt es keine Kommentare, keine Markdown-Codezaeune und keinen Fliesstext ausserhalb des JSON?
- Ist `type` korrekt gesetzt?
- Ist `name` gesetzt?
- Bei Magic Items: Sind `rarity`, `description` und genau ein passender Basis-Typ gesetzt?
- Bei `requiresAttunement: true`: Ist `attunementDescription` vorhanden und ohne vorgeschaltetes `requires attunement by a` geschrieben?
- Bei Spells: Sind `spellLevel`, `school`, `castingTime`, `components`, `range`, `duration`, `description` und `classes` gesetzt?
- Bei Materialkomponenten: Ist `materialDescription` vorhanden?
- Bei Reaction-Spells: Ist `reactionDescription` vorhanden?
- Bei `atHigherLevelsScaling: true`: Gibt es mindestens einen `higherLevels` Eintrag?
- Sind Dropdown-Werte als sichtbare D&D-Beyond-Labels geschrieben?

## Empfohlener Prompt fuer Obsidian Codex

```text
Erzeuge aus den folgenden Kampagnen-Notizen ein valides JSON fuer den D&D Beyond Homebrew Importer.
Nutze exakt die Spezifikation aus "D&D Beyond Homebrew Importer JSON Vorlage".
Gib ausschliesslich JSON aus, ohne Markdown-Codeblock und ohne Erklaertext.
Lasse unbekannte optionale Felder weg.
Keine kampagnenspezifischen Feldnamen erfinden; Spezialfaehigkeiten gehoeren in actions oder description.

Notizen:
<hier Kampagnen-Notizen einfuegen>
```
