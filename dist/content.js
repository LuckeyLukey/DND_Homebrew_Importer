(() => {
  const MESSAGE_TYPE = "DNDBEYOND_IMPORT_ITEM";
  const LOG_PREFIX = "[DDB Homebrew Importer]";
  const WORKFLOW_KEY = "dndbeyond-homebrew-importer:workflow";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) {
      return false;
    }

    const { item, options } = parseImportPayload(message.payload);
    importItem(item, options)
      .then((report) => sendResponse({ ok: true, report }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });

  resumeStoredWorkflow();

  function parseImportPayload(payload) {
    if (payload?.item) {
      return {
        item: payload.item,
        options: payload.options || {}
      };
    }

    return {
      item: payload,
      options: {}
    };
  }

  async function importItem(item, options = {}) {
    const report = createReport();
    const pagePhase = detectPagePhase();
    const magicItemForm = isMagicItemForm();

    report.info(`Starting local import for "${item.name || "unnamed entry"}".`);
    report.info(`Detected D&D Beyond phase: ${pagePhase}.`);
    await waitForPageToSettle();

    if (isModifierPage()) {
      const modifiers = isSpellModifierPage() ? getSpellModifiers(item) : item.modifiers;
      await fillModifierPage(report, modifiers?.[0]);
      report.info("Modifier import abgeschlossen. Bitte kontrollieren und manuell speichern.");
      report.finalMessage = "Modifier import abgeschlossen. Bitte kontrollieren und manuell speichern.";
      report.summary = summarize(report.entries);
      return report;
    }

    if (isConditionPage()) {
      const conditions = isSpellConditionPage() ? getSpellConditions(item) : item.conditions;
      await fillConditionPage(report, conditions?.[0]);
      report.info("Condition import abgeschlossen. Bitte kontrollieren und manuell speichern.");
      report.finalMessage = "Condition import abgeschlossen. Bitte kontrollieren und manuell speichern.";
      report.summary = summarize(report.entries);
      return report;
    }

    if (isSpellHigherLevelPage()) {
      await fillHigherLevelPage(report, getSpellHigherLevels(item)?.[0]);
      report.info("Higher-level import abgeschlossen. Bitte kontrollieren und manuell speichern.");
      report.finalMessage = "Higher-level import abgeschlossen. Bitte kontrollieren und manuell speichern.";
      report.summary = summarize(report.entries);
      return report;
    }

    if (isMagicItemAttachedSpellPage()) {
      await fillSpellPage(report, item.spells?.[0]);
      report.info("Spell import abgeschlossen. Bitte kontrollieren und manuell speichern.");
      report.finalMessage = "Spell import abgeschlossen. Bitte kontrollieren und manuell speichern.";
      report.summary = summarize(report.entries);
      return report;
    }

    if (isHomebrewSpellForm() || normalize(item.type) === "spell") {
      return importSpell(report, item, options, pagePhase);
    }

    await fillTextField(report, "Name", item.name, ["name", "item name"], {
      selectors: ["#field-name"]
    });
    await fillSelectLike(report, "Item Base Type", getBaseItemTypeLabel(item.type), [
      "item base type",
      "base type"
    ], {
      selectors: ["#field-item-base-type"],
      warnOnMissing: false
    });
    await fillSelectLike(report, "Magic Item Type", item.magicItemType, [
      "magic item type",
      "item type"
    ], {
      selectors: ["#field-type", "#field-magic-item-type"],
      warnOnMissing: false
    });
    await fillSelectLike(report, "Base Weapon", item.baseWeapon, [
      "base weapon",
      "base item",
      "weapon"
    ], {
      selectors: ["#field-base-weapon"]
    });
    await fillSelectLike(report, "Base Armor", item.baseArmor, [
      "base armor",
      "armor"
    ], {
      selectors: ["#field-base-armor"],
      warnOnMissing: false
    });
    await fillSelectLike(report, "Dex Bonus", item.dexBonus, [
      "dex bonus",
      "dexterity bonus"
    ], {
      selectors: ["#field-dex-bonus"],
      warnOnMissing: false
    });
    await fillTextField(report, "Strength Requirement", item.strengthRequirement, [
      "strength requirement",
      "str requirement"
    ], {
      selectors: ["#field-strength-requirement", "#field-str-requirement"],
      warnOnMissing: false
    });
    await fillSelectLike(report, "Stealth Check", item.stealthCheck, [
      "stealth check",
      "stealth"
    ], {
      selectors: ["#field-stealth-check"],
      warnOnMissing: false
    });
    await fillSelectLike(report, "Rarity", item.rarity, ["rarity"], {
      selectors: ["#field-rarity"]
    });
    await fillDescription(report, item);

    if (typeof item.requiresAttunement === "boolean") {
      await fillCheckbox(report, "Requires Attunement", item.requiresAttunement, [
        "requires attunement",
        "attunement"
      ], {
        selectors: ["#field-requires-attunement"],
        fakeSelectors: ["#fc-fake-requires-attunement .fc-fake-item"]
      });

      if (item.requiresAttunement) {
        await fillAttunementDescription(report, item);
      }
    }

    if (pagePhase === "create") {
      report.info(
        "Initial creation form detected. D&D Beyond unlocks Notes, Charges, Tags, Modifiers, Spells, and Conditions after the item is saved."
      );
      report.info("Please review the initial fields, save manually, open the edit page, then run this import again for the second pass.");
      report.finalMessage = "Initiale Maske gefüllt. Bitte kontrollieren, manuell speichern und danach auf der Edit-Seite erneut importieren.";
      report.summary = summarize(report.entries);
      return report;
    }

    await fillTextField(report, "Notes", item.notes, ["notes", "note"], {
      selectors: ["#field-notes"]
    });

    if (item.damage?.dice && !magicItemForm) {
      await fillTextField(report, "Damage", item.damage.dice, [
        "damage",
        "damage dice",
        "dice"
      ]);
    }

    if (item.damage?.type && !magicItemForm) {
      await fillSelectLike(report, "Damage Type", item.damage.type, [
        "damage type",
        "type of damage"
      ]);
    }

    if (Array.isArray(item.properties) && !magicItemForm) {
      await fillWeaponProperties(report, item.properties);
    }

    if (magicItemForm && (item.damage || item.properties?.length)) {
      report.info("Damage and weapon properties were included in the Description because this magic-item form does not expose dedicated fields for them.");
    }

    const actions = getItemActions(item);
    if (actions.length) {
      await fillActions(report, actions);
    }

    if (item.modifiers?.length && !options.autoNavigateSubpages) {
      await fillModifiers(report, item.modifiers);
    }

    if (item.conditions?.length && !options.autoNavigateSubpages) {
      await reportSeparateCreatePage(report, "Conditions", "condition", findConditionCreateUrl(), item.conditions.map(formatConditionSummary));
    }

    if (item.spells?.length && !options.autoNavigateSubpages) {
      await reportSeparateCreatePage(report, "Spells", "spell", findSpellCreateUrl(), item.spells.map(formatSpellSummary));
    }

    if (options.autoNavigateSubpages) {
      const started = await startSubpageWorkflow(report, item, options);
      if (started) {
        report.finalMessage = options.autoSaveSubpages
          ? "Unterseiten-Workflow gestartet. Modifier, Conditions und Spells werden automatisch erstellt und gespeichert."
          : "Unterseiten-Workflow gestartet. Die erste Unterseite wird geoeffnet und ausgefuellt; bitte dort manuell speichern.";
        report.summary = summarize(report.entries);
        return report;
      }
    }

    report.info("Import abgeschlossen. Bitte kontrollieren und manuell speichern.");
    report.finalMessage = "Import abgeschlossen. Bitte kontrollieren und manuell speichern.";
    report.summary = summarize(report.entries);
    return report;
  }

  async function importSpell(report, item, options, pagePhase) {
    report.info("Detected D&D Beyond form type: spell.");

    await fillTextField(report, "Spell Name", item.name, ["spell name", "name"], {
      selectors: ["#field-Name", "#field-name"]
    });
    await fillTextField(report, "Version", item.version, ["version"], {
      selectors: ["#field-version"],
      warnOnMissing: false
    });
    await fillSelectLike(report, "Spell Level", item.spellLevel ?? item.level, ["spell level", "level"], {
      selectors: ["#field-spell-level"]
    });
    await fillSelectLike(report, "Spell School", item.school || item.spellSchool, ["spell school", "school"], {
      selectors: ["#field-spell-school"]
    });

    const castingTime = getSpellCastingTime(item);
    await fillTextField(report, "Casting Time", castingTime.amount, ["casting time"], {
      selectors: ["#field-spell-casting-time"]
    });
    await fillSelectLike(report, "Casting Time Type", castingTime.unit, ["casting time", "activation"], {
      selectors: ["#field-spell-activation"]
    });
    await fillTextField(report, "Reaction Casting Time Description", castingTime.reactionDescription, [
      "reaction casting time description",
      "reaction condition"
    ], {
      selectors: ["#field-spell-casting-time-description"],
      warnOnMissing: false
    });

    await fillSpellComponents(report, item);
    await fillTextField(report, "Material Components Description", item.materialDescription || item.materialComponentsDescription || item.materialComponents, [
      "material components description",
      "material components"
    ], {
      selectors: ["#field-spell-components"],
      warnOnMissing: false
    });

    const range = getSpellRange(item);
    await fillSelectLike(report, "Spell Range Type", range.type, ["spell range type", "range type"], {
      selectors: ["#field-origin"]
    });
    await fillTextField(report, "Range Distance", range.distance, ["range distance", "distance"], {
      selectors: ["#field-spell-range"],
      warnOnMissing: false
    });

    const duration = getSpellDuration(item);
    await fillSelectLike(report, "Duration Type", duration.type, ["duration type"], {
      selectors: ["#field-spell-duration"]
    });
    await fillTextField(report, "Duration", duration.amount, ["duration"], {
      selectors: ["#field-spell-duration-interval"],
      warnOnMissing: false
    });
    await fillSelectLike(report, "Duration Unit", duration.unit, ["duration unit"], {
      selectors: ["#field-spell-duration-unit"],
      warnOnMissing: false
    });

    await fillSpellDescription(report, item);

    if (typeof item.ritual === "boolean" || typeof item.canCastAsRitual === "boolean") {
      await fillCheckbox(report, "Ritual Spell", Boolean(item.ritual ?? item.canCastAsRitual), [
        "ritual spell",
        "ritual"
      ], {
        selectors: ["#field-can-cast-as-ritual"],
        warnOnMissing: false
      });
    }

    const higherLevels = getSpellHigherLevels(item);
    if (typeof item.atHigherLevelsScaling === "boolean" || typeof item.higherLevelsScaling === "boolean" || higherLevels.length) {
      await fillCheckbox(report, "At Higher Levels Scaling", Boolean(item.atHigherLevelsScaling ?? item.higherLevelsScaling ?? higherLevels.length), [
        "at higher levels scaling",
        "higher levels"
      ], {
        selectors: ["#field-can-cast-at-higher-level"],
        warnOnMissing: false
      });
    }
    await fillSelectLike(report, "Higher Level Scaling Type", item.higherLevelScale || item.higherLevelScalingType, [
      "higher level scaling type",
      "higher level scale"
    ], {
      selectors: ["#field-higher-level-scale"],
      warnOnMissing: false
    });

    await fillMultiSelectLike(report, "Available Classes", item.classes || item.availableClasses || [], [
      "available for classes",
      "available classes",
      "class mapping"
    ], {
      selectors: ["#field-class-mapping"]
    });

    if (pagePhase !== "create") {
      await fillSpellAdditionalFields(report, item);
    } else {
      report.info("Initial spell creation form detected. D&D Beyond unlocks Modifiers, Conditions, and Higher Level entries after the spell is saved.");
      report.info("Please review the spell fields, save manually, open the edit page, then run this import again for the second pass.");
      report.finalMessage = "Initiale Spell-Maske gefuellt. Bitte kontrollieren, manuell speichern und danach auf der Edit-Seite erneut importieren.";
      report.summary = summarize(report.entries);
      return report;
    }

    const spellModifiers = getSpellModifiers(item);
    const spellConditions = getSpellConditions(item);
    if (spellModifiers.length && !options.autoNavigateSubpages) {
      await reportSeparateCreatePage(report, "Spell modifiers", "modifier", findSpellModifierCreateUrl(), spellModifiers.map(formatModifierSummary));
    }
    if (spellConditions.length && !options.autoNavigateSubpages) {
      await reportSeparateCreatePage(report, "Spell conditions", "condition", findSpellConditionCreateUrl(), spellConditions.map(formatConditionSummary));
    }
    if (higherLevels.length && !options.autoNavigateSubpages) {
      await reportSeparateCreatePage(report, "Higher-level entries", "higher level", findSpellHigherLevelCreateUrl(), higherLevels.map(formatHigherLevelSummary));
    }

    if (options.autoNavigateSubpages) {
      const started = await startSubpageWorkflow(report, item, options);
      if (started) {
        report.finalMessage = options.autoSaveSubpages
          ? "Spell-Unterseiten-Workflow gestartet. Modifier, Conditions und Higher-Level-Eintraege werden automatisch erstellt und gespeichert."
          : "Spell-Unterseiten-Workflow gestartet. Die erste Unterseite wird geoeffnet und ausgefuellt; bitte dort manuell speichern.";
        report.summary = summarize(report.entries);
        return report;
      }
    }

    report.info("Spell import abgeschlossen. Bitte kontrollieren und manuell speichern.");
    report.finalMessage = "Spell import abgeschlossen. Bitte kontrollieren und manuell speichern.";
    report.summary = summarize(report.entries);
    return report;
  }

  async function resumeStoredWorkflow() {
    await waitForPageToSettle();
    const state = await getStoredWorkflow();
    if (!state?.active || !state.item) return;

    const report = createReport();

    if (isModifierPage() || isConditionPage() || isMagicItemAttachedSpellPage() || isSpellHigherLevelPage()) {
      await runWorkflowSubpage(report, state);
      return;
    }

    if (isWorkflowReturnPage(state)) {
      await continueWorkflowFromEditPage(report, state);
    }
  }

  async function startSubpageWorkflow(report, item, options) {
    const queue = buildSubpageQueue(item, report);
    if (!queue.length) {
      report.info("Automatic subpage workflow: no new modifier, condition, spell, or higher-level entries found.");
      return false;
    }

    const firstMissingUrl = queue.find((entry) => !entry.url);
    if (firstMissingUrl) {
      report.warn(`Automatic subpage workflow: Add a ${firstMissingUrl.kind} URL was not found. Expand that section or add it manually.`);
      return false;
    }

    const state = {
      active: true,
      item,
      options: {
        autoNavigateSubpages: Boolean(options.autoNavigateSubpages),
        autoSaveSubpages: Boolean(options.autoSaveSubpages)
      },
      workflowType: getWorkflowType(item),
      returnUrl: window.location.href,
      queue,
      activeEntry: null,
      updatedAt: Date.now()
    };

    await storeWorkflow(state);
    report.info(`Automatic subpage workflow queued ${queue.length} entr${queue.length === 1 ? "y" : "ies"}.`);
    setTimeout(() => continueWorkflowFromEditPage(createReport(), state), 250);
    return true;
  }

  function buildSubpageQueue(item, report) {
    if (getWorkflowType(item) === "spell") {
      return [
        ...buildEntries("modifier", getSpellModifiers(item), findSpellModifierCreateUrl(), collectExistingEntryRows("modifier"), report),
        ...buildEntries("condition", getSpellConditions(item), findSpellConditionCreateUrl(), collectExistingEntryRows("condition"), report),
        ...buildEntries("higherLevel", getSpellHigherLevels(item), findSpellHigherLevelCreateUrl(), collectExistingEntryRows("higherLevel"), report)
      ];
    }

    return [
      ...buildEntries("modifier", item.modifiers, findModifierCreateUrl(), collectExistingEntryRows("modifier"), report),
      ...buildEntries("condition", item.conditions, findConditionCreateUrl(), collectExistingEntryRows("condition"), report),
      ...buildEntries("spell", item.spells, findSpellCreateUrl(), collectExistingEntryRows("spell"), report)
    ];
  }

  function buildEntries(kind, values, url, existingRows, report) {
    if (!Array.isArray(values)) return [];
    return values.reduce((entries, value, index) => {
      const signature = getEntrySignatureParts(kind, value);
      if (matchesExistingEntry(existingRows, signature)) {
        report?.info(`Automatic subpage workflow: ${capitalize(kind)} ${index + 1} already exists and was skipped.`);
        return entries;
      }

      entries.push({ kind, index, url });
      return entries;
    }, []);
  }

  function collectExistingEntryRows(kind) {
    const headerTermsByKind = {
      modifier: ["modifier", "fixed value", "restriction"],
      condition: ["condition name", "condition duration"],
      spell: ["spell name", "minimum charges", "save dc"],
      higherLevel: ["scale effect", "fixed value"]
    };
    const headerTerms = headerTermsByKind[kind] || [];
    const rows = [];

    for (const table of Array.from(document.querySelectorAll("table"))) {
      const headingText = normalize(
        Array.from(table.querySelectorAll("thead th, tr:first-child th, tr:first-child td"))
          .map((cell) => cell.textContent)
          .join(" ")
      );
      if (!headerTerms.every((term) => headingText.includes(normalize(term)))) continue;

      for (const row of Array.from(table.querySelectorAll("tbody tr, tr"))) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (!cells.length) continue;

        const text = normalize(cells.map((cell) => cell.textContent).join(" "))
          .replace(/\b(edit|delete|actions?)\b/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) rows.push(text);
      }
    }

    return rows;
  }

  function getEntrySignatureParts(kind, value) {
    if (!value || typeof value !== "object") return [];

    if (kind === "modifier") {
      return compactSignatureParts([
        [value.type, value.subType || value.subtype].filter(Boolean).join(" "),
        value.value,
        value.fixedValue,
        value.abilityScore || value.ability || value.rpgStat,
        value.diceCount,
        value.dieType || value.diceType,
        value.details || value.restriction,
        value.durationInterval,
        value.durationUnit
      ]);
    }

    if (kind === "condition") {
      return compactSignatureParts([
        value.effect || value.conditionEffect,
        value.condition || value.name,
        [value.duration, value.durationUnit].filter((part) => part !== undefined && part !== "").join(" "),
        value.details || value.exception
      ]);
    }

    if (kind === "spell") {
      return compactSignatureParts([
        value.name || value.spellName,
        value.minCharges,
        value.maxCharges,
        value.saveDc,
        value.details || value.restriction
      ]);
    }

    if (kind === "higherLevel") {
      return compactSignatureParts([
        value.level || value.scalingLevel,
        value.modifier,
        value.effect || value.scaleEffect,
        value.diceCount,
        value.dieType || value.diceType,
        value.fixedValue || value.value,
        value.details
      ]);
    }

    return [];
  }

  function compactSignatureParts(parts) {
    return parts
      .map((part) => normalize(part))
      .filter((part) => part && part !== "false");
  }

  function matchesExistingEntry(existingRows, signatureParts) {
    if (!existingRows.length || !signatureParts.length) return false;
    return existingRows.some((rowText) => signatureParts.every((part) => rowText.includes(part)));
  }

  async function continueWorkflowFromEditPage(report, state) {
    if (state.activeEntry) return;

    const [next, ...remaining] = state.queue || [];
    if (!next) {
      await clearWorkflow();
      report.info("Automatic subpage workflow completed. Main item changes still need manual review/save if changed.");
      return;
    }

    const freshUrl = findCreateUrlForKind(next.kind) || next.url;
    if (!freshUrl) {
      await clearWorkflow();
      report.warn(`Automatic subpage workflow stopped: Add a ${next.kind} URL was not found.`);
      return;
    }

    const nextState = {
      ...state,
      queue: remaining,
      activeEntry: {
        ...next,
        url: freshUrl
      },
      updatedAt: Date.now()
    };
    await storeWorkflow(nextState);
    report.info(`Opening ${next.kind} ${next.index + 1}.`);
    window.location.href = freshUrl;
  }

  function findCreateUrlForKind(kind) {
    if (kind === "modifier") return findModifierCreateUrl();
    if (kind === "condition") return findConditionCreateUrl();
    if (kind === "spell") return findSpellCreateUrl();
    if (kind === "higherLevel") return findSpellHigherLevelCreateUrl();
    return "";
  }

  async function runWorkflowSubpage(report, state) {
    const entry = state.activeEntry;
    if (!entry) return;

    const expectedPage = (entry.kind === "modifier" && isModifierPage()) ||
      (entry.kind === "condition" && isConditionPage()) ||
      (entry.kind === "spell" && isMagicItemAttachedSpellPage()) ||
      (entry.kind === "higherLevel" && isSpellHigherLevelPage());
    if (!expectedPage) return;

    report.info(`Automatic subpage workflow: filling ${entry.kind} ${entry.index + 1}.`);
    const filled = await fillWorkflowEntry(report, state.item, entry, state);
    if (!filled) {
      report.warn(`Automatic subpage workflow: ${entry.kind} ${entry.index + 1} was not filled.`);
      await clearWorkflow();
      return;
    }

    if (!state.options?.autoSaveSubpages) {
      await storeWorkflow({ ...state, active: false, updatedAt: Date.now() });
      report.info("Automatic subpage workflow paused. Review this page and save manually.");
      return;
    }

    await storeWorkflow({
      ...state,
      activeEntry: null,
      updatedAt: Date.now()
    });

    const clicked = clickSubpageSaveButton();
    if (!clicked) {
      await clearWorkflow();
      report.warn("Automatic subpage workflow stopped: Save button was not found.");
    }
  }

  async function fillWorkflowEntry(report, item, entry, state) {
    if (entry.kind === "modifier") {
      const modifiers = state.workflowType === "spell" ? getSpellModifiers(item) : item.modifiers;
      return fillModifierPage(report, modifiers?.[entry.index]);
    }
    if (entry.kind === "condition") {
      const conditions = state.workflowType === "spell" ? getSpellConditions(item) : item.conditions;
      return fillConditionPage(report, conditions?.[entry.index]);
    }
    if (entry.kind === "spell") {
      return fillSpellPage(report, item.spells?.[entry.index]);
    }
    if (entry.kind === "higherLevel") {
      return fillHigherLevelPage(report, getSpellHigherLevels(item)?.[entry.index]);
    }
    return false;
  }

  function clickSubpageSaveButton() {
    const buttons = Array.from(document.querySelectorAll("button, input[type='submit']"));
    const button = buttons.find((candidate) =>
      candidate.matches("button[type='submit'], input[type='submit']") &&
      normalize(candidate.textContent || candidate.value).includes("save")
    ) || buttons.find((candidate) => normalize(candidate.textContent || candidate.value) === "save");

    if (!button) return false;
    setTimeout(() => button.click(), 250);
    return true;
  }

  function isMagicItemEditPage() {
    return detectPagePhase() === "edit" && !isModifierPage() && !isConditionPage() && !isMagicItemAttachedSpellPage() && !isSpellHigherLevelPage() && !isHomebrewSpellForm();
  }

  function getStoredWorkflow() {
    return new Promise((resolve) => {
      chrome.storage?.local?.get?.(WORKFLOW_KEY, (stored) => resolve(stored?.[WORKFLOW_KEY] || null));
    });
  }

  function storeWorkflow(state) {
    return new Promise((resolve) => {
      chrome.storage?.local?.set?.({ [WORKFLOW_KEY]: state }, resolve);
    });
  }

  function clearWorkflow() {
    return new Promise((resolve) => {
      chrome.storage?.local?.remove?.(WORKFLOW_KEY, resolve);
    });
  }

  function detectPagePhase() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes("/create")) return "create";
    if (path.includes("/edit")) return "edit";
    if (document.querySelector("#field-notes, #field-has-charges, #field-magic-item-tags-public")) return "edit";
    return "create";
  }

  function isMagicItemForm() {
    return Boolean(
      document.querySelector("#magic-item-form, #field-item-base-type, #field-rarity, #field-item-description-wysiwyg")
    );
  }

  function isHomebrewSpellForm() {
    return Boolean(
      document.querySelector("#spell-form, #field-spell-level, #field-spell-description-wysiwyg")
    ) && !isSpellSubpage();
  }

  function isWorkflowReturnPage(state) {
    if (state?.workflowType === "spell") return isHomebrewSpellForm() && detectPagePhase() === "edit";
    return isMagicItemEditPage();
  }

  function getBaseItemTypeLabel(type) {
    const normalizedType = normalize(type);
    if (normalizedType === "weapon") return "Weapon";
    if (normalizedType === "armor" || normalizedType === "armour") return "Armor";
    if (normalizedType === "item" || normalizedType === "wondrous item" || normalizedType === "wondrous") return "Item";
    return type;
  }

  function isModifierPage() {
    return window.location.pathname.toLowerCase().includes("/modifier/");
  }

  function isConditionPage() {
    return window.location.pathname.toLowerCase().includes("/condition/");
  }

  function isMagicItemAttachedSpellPage() {
    return window.location.pathname.toLowerCase().includes("/magic-items/spell/");
  }

  function isSpellModifierPage() {
    return window.location.pathname.toLowerCase().includes("/spells/modifier/");
  }

  function isSpellConditionPage() {
    return window.location.pathname.toLowerCase().includes("/spells/condition/");
  }

  function isSpellHigherLevelPage() {
    return window.location.pathname.toLowerCase().includes("/spells/additional/");
  }

  function isSpellSubpage() {
    return isSpellModifierPage() || isSpellConditionPage() || isSpellHigherLevelPage();
  }

  function getWorkflowType(item) {
    return normalize(item?.type) === "spell" || isHomebrewSpellForm() || isSpellSubpage() ? "spell" : "magic-item";
  }

  function getSpellModifiers(item) {
    return Array.isArray(item.spellModifiers) ? item.spellModifiers : Array.isArray(item.modifiers) ? item.modifiers : [];
  }

  function getSpellConditions(item) {
    return Array.isArray(item.spellConditions) ? item.spellConditions : Array.isArray(item.conditions) ? item.conditions : [];
  }

  function getSpellHigherLevels(item) {
    if (Array.isArray(item.higherLevels)) return item.higherLevels;
    if (Array.isArray(item.higherLevelScaling)) return item.higherLevelScaling;
    return [];
  }

  function getSpellCastingTime(item) {
    const value = item.castingTime || {};
    if (typeof value === "string") {
      const match = value.match(/^(\d+)\s+(.+)$/);
      return {
        amount: match?.[1] || "",
        unit: match?.[2] || value,
        reactionDescription: item.reactionDescription || item.reactionCastingTimeDescription || ""
      };
    }

    return {
      amount: value.amount ?? value.number ?? item.castingTimeAmount ?? item.castingTimeNumber ?? "",
      unit: value.unit || value.type || item.castingTimeType || item.activation || "",
      reactionDescription: value.reactionDescription || item.reactionDescription || item.reactionCastingTimeDescription || ""
    };
  }

  function getSpellRange(item) {
    const value = item.range || {};
    if (typeof value === "string") return { type: value, distance: item.rangeDistance || "" };
    return {
      type: value.type || item.rangeType || item.spellRangeType || "",
      distance: value.distance ?? item.rangeDistance ?? item.spellRange ?? ""
    };
  }

  function getSpellDuration(item) {
    const value = item.duration || {};
    if (typeof value === "string") return { type: value, amount: item.durationAmount || "", unit: item.durationUnit || "" };
    return {
      type: value.type || item.durationType || "",
      amount: value.amount ?? value.interval ?? item.durationAmount ?? item.durationInterval ?? "",
      unit: value.unit || item.durationUnit || ""
    };
  }

  async function fillSpellComponents(report, item) {
    const components = item.components || {};
    const list = Array.isArray(components)
      ? components.map((component) => normalize(component))
      : Object.entries(components).filter(([, enabled]) => Boolean(enabled)).map(([component]) => normalize(component));

    const has = (shortName, longName) => list.includes(normalize(shortName)) || list.includes(normalize(longName));
    const explicit = list.length > 0;
    if (!explicit) {
      report.info("Components: skipped empty value.");
      return false;
    }

    let filled = false;
    filled = await fillCheckbox(report, "Component: Verbal", has("v", "verbal"), ["verbal"], {
      selectors: ["#field-verbal-field"],
      warnOnMissing: false
    }) || filled;
    filled = await fillCheckbox(report, "Component: Somatic", has("s", "somatic"), ["somatic"], {
      selectors: ["#field-somatic-field"],
      warnOnMissing: false
    }) || filled;
    filled = await fillCheckbox(report, "Component: Material", has("m", "material"), ["material"], {
      selectors: ["#field-material-field"],
      warnOnMissing: false
    }) || filled;
    return filled;
  }

  async function fillSpellDescription(report, item) {
    const html = paragraphsToHtml(item.description || item.spellDescription || "");
    if (!html) {
      report.info("Description: skipped empty value.");
      return false;
    }

    const tinyFilled = await setTinyMceContent("field-spell-description-wysiwyg", html);
    const wysiwyg = document.querySelector("#field-spell-description-wysiwyg");
    const markup = document.querySelector("#field-spell-description");

    let filled = false;
    for (const control of [wysiwyg, markup]) {
      if (!control) continue;
      setTextLikeValue(control, html);
      fireInputEvents(control);
      filled = true;
    }

    if (tinyFilled || filled) {
      report.info("Description: filled D&D Beyond spell TinyMCE/markup fields.");
      return true;
    }

    return fillTextField(report, "Description", htmlToPlainText(html), ["description"]);
  }

  async function fillSpellAdditionalFields(report, item) {
    const area = item.areaOfEffect || {};
    await fillSelectLike(report, "Area of Effect Type", area.type || item.areaOfEffectType, ["area of effect type"], {
      selectors: ["#field-spell-aoe"],
      warnOnMissing: false
    });
    await fillTextField(report, "Area of Effect Size", area.size ?? item.areaOfEffectSize, ["area of effect size"], {
      selectors: ["#field-spell-aoe-size"],
      warnOnMissing: false
    });
    await fillCheckbox(report, "Area of Effect Special Flag", Boolean(area.special ?? item.areaOfEffectSpecial), [
      "area of effect special flag"
    ], {
      selectors: ["#field-aoe-special"],
      warnOnMissing: false
    });
    await fillTextField(report, "Area of Effect Special Description", area.description || item.areaOfEffectSpecialDescription, [
      "area of effect special"
    ], {
      selectors: ["#field-aoe-special-description"],
      warnOnMissing: false
    });

    await fillCheckbox(report, "As Part of Weapon Attack", Boolean(item.asPartOfWeaponAttack), ["as part of weapon attack"], {
      selectors: ["#field-as-part-of-weapon-attack"],
      warnOnMissing: false
    });
    await fillSelectLike(report, "Attack Type", item.attackType, ["attack type"], {
      selectors: ["#field-attack-type"],
      warnOnMissing: false
    });
    await fillSelectLike(report, "Save Type", item.saveType, ["save type"], {
      selectors: ["#field-save-type", "#field-spell-save-type"],
      warnOnMissing: false
    });
    await fillTextField(report, "Effect On Miss", item.effectOnMiss, ["effect on miss"], {
      selectors: ["#field-on-miss"],
      warnOnMissing: false
    });
    await fillTextField(report, "Effect On Save Success", item.effectOnSaveSuccess, ["effect on save success"], {
      selectors: ["#field-spell-save-success"],
      warnOnMissing: false
    });
    await fillTextField(report, "Effect On Save Fail", item.effectOnSaveFail, ["effect on save fail"], {
      selectors: ["#field-spell-save-fail"],
      warnOnMissing: false
    });
    await fillMultiSelectLike(report, "Spell Effect Tags", item.tags || item.spellEffectTags || [], [
      "spell effect tags",
      "tags"
    ], {
      selectors: ["#field-tags", "#field-spell-tags"],
      warnOnMissing: false
    });
  }

  async function fillActions(report, actions) {
    const description = actions.map(formatActionText).join("\n\n");

    await fillTextField(report, "Actions", description, [
      "action",
      "actions",
      "special",
      "activation"
    ], { warnOnMissing: false });

    const limitedUseAction = actions.find((action) => Number.isFinite(Number(action.uses)));
    if (limitedUseAction) {
      await fillCheckbox(report, "Has Charges", true, ["has charges", "charges"], {
        selectors: ["#field-has-charges"],
        fakeSelectors: ["#fc-fake-has-charges .fc-fake-item"],
        warnOnMissing: false
      });
      await fillTextField(report, "Limited Uses", String(limitedUseAction.uses), [
        "limited uses",
        "uses",
        "number of uses"
      ], {
        selectors: ["#field-number-of-charges"]
      });
    }

    const resetAction = actions.find((action) => action.reset);
    if (resetAction) {
      await fillSelectLike(report, "Limited Use Reset", resetAction.reset, [
        "reset",
        "reset type",
        "recharge"
      ], {
        selectors: ["#field-charge-reset-condition"]
      });
    }
  }

  async function fillModifiers(report, modifiers) {
    const compact = modifiers
      .map((modifier) => {
        const parts = [
          modifier.type,
          modifier.subType,
          modifier.value !== undefined ? `+${modifier.value}` : null
        ].filter(Boolean);
        return parts.join(" - ");
      })
      .join("\n");

    const filledAsNotes = await fillTextField(report, "Modifiers", compact, [
      "modifier",
      "modifiers"
    ], { warnOnMissing: false });

    if (!filledAsNotes) {
      const modifierUrl = findModifierCreateUrl();
      if (modifierUrl) {
        report.warn(
          "Modifiers are created on a separate D&D Beyond page. Open Add a Modifier, then run the import again there for the first modifier: " + modifierUrl
        );
        report.info("Modifier summary to create: " + compact);
      } else {
        report.warn(
          "Modifiers UI was not found. D&D Beyond may require a separate modifier page; add these manually if needed: " + compact
        );
      }
    }
  }

  async function fillModifierPage(report, modifier) {
    if (!modifier) {
      report.warn("No modifier object found in JSON. Add a modifiers array with at least one entry.");
      return false;
    }

    let filled = false;
    const modifierTypeResult = await fillDdbModifierSelect(report, "Modifier Type", "#field-spell-modifier-type", modifier.type);
    filled = modifierTypeResult || filled;

    const modifierSubType = modifier.subType || modifier.subtype;
    if (modifier.type && modifierSubType) {
      await waitForModifierSubtype(modifierSubType, modifierTypeResult?.value, 2500);
    }

    filled = await fillDdbModifierSelect(report, "Modifier Subtype", "#field-spell-modifier-sub-type", modifierSubType, {
      modifierTypeValue: modifierTypeResult?.value
    }) || filled;

    filled = await fillSelectLike(report, "Modifier Ability Score", modifier.abilityScore || modifier.ability || modifier.rpgStat, [
      "ability score",
      "rpg stat"
    ], {
      selectors: ["#field-rpg-stat"],
      warnOnMissing: false
    }) || filled;

    if (hasNonZeroNumericValue(modifier.value)) {
      filled = await fillTextField(report, "Modifier Value", String(modifier.value), [
        "fixed value",
        "value",
        "bonus",
        "amount"
      ], {
        selectors: ["#field-fixed-value"],
        warnOnMissing: false
      }) || filled;
    } else if (isExplicitZero(modifier.value)) {
      report.info("Modifier Value: skipped explicit 0.");
    }

    if (hasPositiveNumericValue(modifier.diceCount)) {
      filled = await fillTextField(report, "Modifier Dice Count", String(modifier.diceCount), [
        "dice count"
      ], {
        selectors: ["#field-dice-count"],
        warnOnMissing: false
      }) || filled;
    } else if (isExplicitZero(modifier.diceCount)) {
      report.info("Modifier Dice Count: skipped explicit 0.");
    }

    filled = await fillSelectLike(report, "Modifier Die Type", modifier.dieType || modifier.diceType, [
      "die type",
      "dice type"
    ], {
      selectors: ["#field-dice-value"],
      warnOnMissing: false
    }) || filled;

    if (Array.isArray(modifier.additionalBonusTypes)) {
      filled = await fillMultiSelectLike(report, "Additional Bonus Types", modifier.additionalBonusTypes, [
        "additional bonus types"
      ], {
        selectors: ["#field-additional-bonus-type"],
        warnOnMissing: false
      }) || filled;
    }

    if (modifier.details || modifier.restriction) {
      filled = await fillTextField(report, "Modifier Details", modifier.details || modifier.restriction, [
        "details",
        "restriction"
      ], {
        selectors: ["#field-restriction"],
        warnOnMissing: false
      }) || filled;
    }

    if (hasPositiveNumericValue(modifier.durationInterval)) {
      filled = await fillTextField(report, "Modifier Duration Interval", String(modifier.durationInterval), [
        "duration interval"
      ], {
        selectors: ["#field-duration-interval", "#field-duration"],
        warnOnMissing: false
      }) || filled;
    } else if (isExplicitZero(modifier.durationInterval)) {
      report.info("Modifier Duration Interval: skipped explicit 0.");
    }

    if (hasPositiveNumericValue(modifier.duration)) {
      filled = await fillTextField(report, "Modifier Duration", String(modifier.duration), [
        "duration"
      ], {
        selectors: ["#field-duration", "#field-duration-interval"],
        warnOnMissing: false
      }) || filled;
    } else if (isExplicitZero(modifier.duration)) {
      report.info("Modifier Duration: skipped explicit 0.");
    }

    if (hasPositiveNumericValue(modifier.duration) || hasPositiveNumericValue(modifier.durationInterval)) {
      filled = await fillSelectLike(report, "Modifier Duration Unit", modifier.durationUnit, [
        "duration unit"
      ], {
        selectors: ["#field-duration-unit"],
        warnOnMissing: false
      }) || filled;
    } else if (modifier.durationUnit) {
      report.info("Modifier Duration Unit: skipped because duration is empty or 0.");
    }

    if (typeof modifier.requiresAttunement === "boolean") {
      filled = await fillCheckbox(report, "Modifier Requires Attunement", modifier.requiresAttunement, [
        "requires attunement",
        "attunement"
      ], {
        selectors: ["#field-requires-attunement"],
        fakeSelectors: ["#fc-fake-requires-attunement .fc-fake-item"],
        warnOnMissing: false
      }) || filled;
    }

    if (typeof modifier.usePrimaryStat === "boolean" || typeof modifier.primaryStat === "boolean") {
      filled = await fillCheckbox(report, "Modifier Use Primary Stat", Boolean(modifier.usePrimaryStat ?? modifier.primaryStat), [
        "use primary stat",
        "primary stat"
      ], {
        selectors: ["#field-primary-stat"],
        warnOnMissing: false
      }) || filled;
    }

    if (!filled) {
      report.warn("Modifier create form fields were not found. Please provide the saved HTML for the modifier page so selectors can be mapped exactly.");
    }

    return filled;
  }

  async function fillConditionPage(report, condition) {
    if (!condition) {
      report.warn("No condition object found in JSON. Add a conditions array with at least one entry.");
      return false;
    }

    let filled = false;
    if (typeof condition.hide === "boolean") {
      filled = await fillCheckbox(report, "Condition Hide", condition.hide, ["hide"], {
        selectors: ["#field-hide"],
        warnOnMissing: false
      }) || filled;
    }

    if (condition.effect || condition.conditionEffect) {
      filled = await fillRadioLike(report, "Condition Effect", condition.effect || condition.conditionEffect, [
        "condition effect"
      ], {
        selectors: ["input[name='condition-effect']"],
        warnOnMissing: false
      }) || filled;
    }

    filled = await fillSelectLike(report, "Condition", condition.condition || condition.name, [
      "condition"
    ], {
      selectors: ["#field-item-condition", "#field-condition"]
    }) || filled;

    if (hasPositiveNumericValue(condition.duration)) {
      filled = await fillTextField(report, "Condition Duration", String(condition.duration), [
        "condition duration",
        "duration"
      ], {
        selectors: ["#field-condition-duration"],
        warnOnMissing: false
      }) || filled;
    } else if (isExplicitZero(condition.duration)) {
      report.info("Condition Duration: skipped explicit 0.");
    }

    filled = await fillSelectLike(report, "Condition Duration Unit", condition.durationUnit, [
      "duration unit"
    ], {
      selectors: ["#field-duration-unit"],
      warnOnMissing: false
    }) || filled;

    if (condition.details || condition.exception) {
      filled = await fillTextField(report, "Condition Details", condition.details || condition.exception, [
        "details",
        "exception"
      ], {
        selectors: ["#field-condition-exception"],
        warnOnMissing: false
      }) || filled;
    }

    return filled;
  }

  async function fillSpellPage(report, spell) {
    if (!spell) {
      report.warn("No spell object found in JSON. Add a spells array with at least one entry.");
      return false;
    }

    let filled = false;
    filled = await fillSelectLike(report, "Spell Name", spell.name || spell.spellName, [
      "spell name",
      "spell"
    ], {
      selectors: ["#field-item-spell"]
    }) || filled;

    if (spell.minCharges !== undefined) {
      filled = await fillTextField(report, "Spell Min Charges", String(spell.minCharges), [
        "min charges"
      ], {
        selectors: ["#field-min-charges"],
        warnOnMissing: false
      }) || filled;
    }

    if (spell.maxCharges !== undefined) {
      filled = await fillTextField(report, "Spell Max Charges", String(spell.maxCharges), [
        "max charges"
      ], {
        selectors: ["#field-max-charges"],
        warnOnMissing: false
      }) || filled;
    }

    if (spell.saveDc !== undefined) {
      filled = await fillTextField(report, "Spell Save DC", String(spell.saveDc), [
        "save dc"
      ], {
        selectors: ["#field-save-dc"],
        warnOnMissing: false
      }) || filled;
    }

    if (spell.castAtLevel) {
      await waitForNativeOption("#field-cast-at-level", spell.castAtLevel, 2500);
      filled = await fillSelectLike(report, "Cast At Spell Level", spell.castAtLevel, [
        "cast at spell level",
        "spell level"
      ], {
        selectors: ["#field-cast-at-level"],
        warnOnMissing: false
      }) || filled;
    }

    if (spell.details || spell.restriction) {
      filled = await fillTextField(report, "Spell Details", spell.details || spell.restriction, [
        "details",
        "restriction"
      ], {
        selectors: ["#field-restriction"],
        warnOnMissing: false
      }) || filled;
    }

    return filled;
  }

  async function fillHigherLevelPage(report, higherLevel) {
    if (!higherLevel) {
      report.warn("No higher-level object found in JSON. Add a higherLevels array with at least one entry.");
      return false;
    }

    let filled = false;
    if (higherLevel.level !== undefined || higherLevel.scalingLevel !== undefined) {
      filled = await fillTextField(report, "Scaling Level Value", String(higherLevel.level ?? higherLevel.scalingLevel), [
        "scaling level value",
        "level"
      ], {
        selectors: ["#field-level"]
      }) || filled;
    }

    filled = await fillSelectLike(report, "Modifier to Scale", higherLevel.modifier || higherLevel.modifierToScale, [
      "modifier to scale",
      "modifier"
    ], {
      selectors: ["#field-modifier"],
      warnOnMissing: false
    }) || filled;

    const scaleEffect = normalizeScaleEffect(higherLevel.effect || higherLevel.scaleEffect);
    filled = await fillSelectLike(report, "Scale Effect", scaleEffect, [
      "scale effect",
      "effect type"
    ], {
      selectors: ["#field-effect-type"]
    }) || filled;

    if (hasPositiveNumericValue(higherLevel.diceCount)) {
      filled = await fillTextField(report, "Higher Level Dice Count", String(higherLevel.diceCount), [
        "dice count"
      ], {
        selectors: ["#field-dice-count"],
        warnOnMissing: false
      }) || filled;
    } else if (isExplicitZero(higherLevel.diceCount)) {
      report.info("Higher Level Dice Count: skipped explicit 0.");
    }

    filled = await fillSelectLike(report, "Higher Level Die Type", higherLevel.dieType || higherLevel.diceType, [
      "die type",
      "dice type"
    ], {
      selectors: ["#field-dice-value"],
      warnOnMissing: false
    }) || filled;

    if (hasNonZeroNumericValue(higherLevel.fixedValue ?? higherLevel.value)) {
      filled = await fillTextField(report, "Higher Level Fixed Value", String(higherLevel.fixedValue ?? higherLevel.value), [
        "fixed value"
      ], {
        selectors: ["#field-dice-fixed"],
        warnOnMissing: false
      }) || filled;
    } else if (isExplicitZero(higherLevel.fixedValue ?? higherLevel.value)) {
      report.info("Higher Level Fixed Value: skipped explicit 0.");
    }

    if (higherLevel.details) {
      filled = await fillTextField(report, "Higher Level Details", higherLevel.details, [
        "details"
      ], {
        selectors: ["#field-dice-details"],
        warnOnMissing: false
      }) || filled;
    }

    return filled;
  }

  function normalizeScaleEffect(value) {
    const normalized = normalize(value);
    const aliases = {
      "additional dice": "Additional Points",
      "add dice": "Additional Points",
      "extra dice": "Additional Points",
      "additional die": "Additional Points",
      "additional damage": "Additional Points",
      "additional healing": "Additional Points",
      "additional point": "Additional Points",
      "additional points": "Additional Points",
      "additional target": "Additional Targets",
      "additional targets": "Additional Targets",
      "additional creature": "Additional Creatures",
      "additional creatures": "Additional Creatures",
      "additional count": "Additional Count",
      "extended area": "Extended Area",
      "extended duration": "Extended Duration",
      "extended range": "Extended Range",
      "special": "Special"
    };

    return aliases[normalized] || value;
  }

  function hasPositiveNumericValue(value) {
    if (value === undefined || value === null || value === "") return false;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue > 0 : true;
  }

  function hasNonZeroNumericValue(value) {
    if (value === undefined || value === null || value === "") return false;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue !== 0 : true;
  }

  function isExplicitZero(value) {
    return value !== undefined && value !== null && value !== "" && Number(value) === 0;
  }

  function findModifierCreateUrl() {
    const link = Array.from(document.querySelectorAll("a[href*='/modifier/create/']"))
      .find((candidate) => normalize(candidate.textContent).includes("add a modifier")) ||
      document.querySelector("a[href*='/modifier/create/']");
    return link?.href || "";
  }

  function findConditionCreateUrl() {
    const link = Array.from(document.querySelectorAll("a[href*='/condition/create/']"))
      .find((candidate) => normalize(candidate.textContent).includes("add a condition")) ||
      document.querySelector("a[href*='/condition/create/']");
    return link?.href || "";
  }

  function findSpellCreateUrl() {
    const link = Array.from(document.querySelectorAll("a[href*='/spell/create/']"))
      .find((candidate) => normalize(candidate.textContent).includes("add a spell")) ||
      document.querySelector("a[href*='/spell/create/']");
    return link?.href || "";
  }

  function findSpellModifierCreateUrl() {
    const link = Array.from(document.querySelectorAll("a[href*='/spells/modifier/create/'], a[href*='/modifier/create/']"))
      .find((candidate) => normalize(candidate.textContent).includes("add a modifier")) ||
      document.querySelector("a[href*='/spells/modifier/create/'], a[href*='/modifier/create/']");
    return link?.href || "";
  }

  function findSpellConditionCreateUrl() {
    const link = Array.from(document.querySelectorAll("a[href*='/spells/condition/create/'], a[href*='/condition/create/']"))
      .find((candidate) => normalize(candidate.textContent).includes("add a condition")) ||
      document.querySelector("a[href*='/spells/condition/create/'], a[href*='/condition/create/']");
    return link?.href || "";
  }

  function findSpellHigherLevelCreateUrl() {
    const link = Array.from(document.querySelectorAll("a[href*='/spells/additional/create/']"))
      .find((candidate) => normalize(candidate.textContent).includes("add a higher level") || normalize(candidate.textContent).includes("higher level")) ||
      document.querySelector("a[href*='/spells/additional/create/']");
    return link?.href || "";
  }

  async function reportSeparateCreatePage(report, labelPlural, labelSingular, url, summaries) {
    const compact = summaries.filter(Boolean).join("\n");
    if (url) {
      report.warn(
        `${labelPlural} are created on a separate D&D Beyond page. Open Add a ${capitalize(labelSingular)}, then run the import again there for the first ${labelSingular}: ${url}`
      );
      if (compact) report.info(`${capitalize(labelSingular)} summary to create: ${compact}`);
      return;
    }

    report.warn(`${labelPlural} UI was not found. Add manually if needed: ${compact}`);
  }

  async function fillWeaponProperties(report, properties) {
    for (const property of properties) {
      const checkboxFilled = await fillCheckbox(report, `Weapon Property: ${property}`, true, [
        property,
        "weapon properties",
        "properties"
      ], { warnOnMissing: false });

      if (checkboxFilled) {
        continue;
      }

      const selectFilled = await fillSelectLike(report, `Weapon Property: ${property}`, property, [
        "weapon properties",
        "properties"
      ], { warnOnMissing: false });

      if (!selectFilled) {
        report.warn(`Weapon property "${property}" was not found. It may need to be added manually.`);
      }
    }
  }

  async function fillDescription(report, item) {
    const html = buildMagicItemDescriptionHtml(item);
    if (!html) {
      report.info("Description: skipped empty value.");
      return false;
    }

    const tinyFilled = await setTinyMceContent("field-item-description-wysiwyg", html);
    const wysiwyg = document.querySelector("#field-item-description-wysiwyg");
    const markup = document.querySelector("#field-item-description");

    let filled = false;
    for (const control of [wysiwyg, markup]) {
      if (!control) continue;
      setTextLikeValue(control, html);
      fireInputEvents(control);
      filled = true;
    }

    if (tinyFilled || filled) {
      report.info("Description: filled D&D Beyond TinyMCE/markup fields.");
      return true;
    }

    return fillTextField(report, "Description", htmlToPlainText(html), [
      "description",
      "snippet",
      "details"
    ]);
  }

  async function fillAttunementDescription(report, item) {
    const value = cleanAttunementDescription(item.attunementDescription ||
      item.attunement?.description ||
      `creature that can wield ${item.name || "this item"}.`);

    await waitForSelector("#field-attunement-description, [name='attunement-description']", 1200);

    return fillTextField(report, "Attunement Description", value, [
      "attunement description",
      "attunement",
      "additional details regarding attuning"
    ], {
      selectors: ["#field-attunement-description", "[name='attunement-description']"]
    });
  }

  function cleanAttunementDescription(value) {
    return String(value || "")
      .trim()
      .replace(/^requires\s+attunement\s+by\s+(a|an|the)\s+/i, "")
      .replace(/^requires\s+attunement\s+by\s+/i, "")
      .replace(/^requires\s+attunement\s*/i, "")
      .replace(/^by\s+(a|an|the)\s+/i, "")
      .replace(/^(a|an|the)\s+/i, "")
      .trim();
  }

  async function fillTextField(report, label, value, terms, options = {}) {
    if (value === undefined || value === null || value === "") {
      report.info(`${label}: skipped empty value.`);
      return false;
    }

    const control = findFirstSelector(options.selectors, { allowHidden: true }) ||
      findFieldByTerms(terms, ["input", "textarea", '[contenteditable="true"]']);
    if (!control) {
      if (options.warnOnMissing !== false) {
        report.warn(`${label}: field not found.`);
      }
      return false;
    }

    setTextLikeValue(control, String(value));
    fireInputEvents(control);
    report.info(`${label}: filled using ${describeElement(control)}.`);
    return true;
  }

  async function fillCheckbox(report, label, wanted, terms, options = {}) {
    const checkbox = findFirstSelector(options.selectors, { allowHidden: true }) ||
      findFieldByTerms(terms, ['input[type="checkbox"]']);
    if (!checkbox) {
      if (options.warnOnMissing !== false) {
        report.warn(`${label}: checkbox not found.`);
      }
      return false;
    }

    const fake = findFirstSelector(options.fakeSelectors) || findFakeCheckboxFor(checkbox);
    if (checkbox.checked !== wanted) {
      (fake || checkbox).click();
    }

    setCheckboxChecked(checkbox, wanted);
    syncFakeCheckbox(fake, wanted);
    syncCheckboxInPageContext(checkbox, wanted);
    fireInputEvents(checkbox);

    report.info(`${label}: set to ${wanted ? "checked" : "unchecked"}.`);
    return true;
  }

  async function fillRadioLike(report, label, value, terms, options = {}) {
    if (!value) {
      report.info(`${label}: skipped empty value.`);
      return false;
    }

    const radios = options.selectors?.length
      ? options.selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      : Array.from(document.querySelectorAll("input[type='radio']"));
    const wanted = normalize(value);
    const radio = radios.find((candidate) => {
      const id = candidate.getAttribute("id");
      const labelText = id ? Array.from(document.querySelectorAll(`label[for="${cssEscape(id)}"], label#${cssEscape(id)}`)).map((node) => node.textContent).join(" ") : "";
      return normalize([candidate.value, candidate.name, id, labelText].join(" ")).includes(wanted);
    }) || rankCandidates(radios, terms.concat([value]))[0]?.element;

    if (!radio) {
      if (options.warnOnMissing !== false) report.warn(`${label}: radio option "${value}" not found.`);
      return false;
    }

    radio.click();
    radio.checked = true;
    fireInputEvents(radio);
    report.info(`${label}: selected "${value}".`);
    return true;
  }

  function setCheckboxChecked(checkbox, wanted) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
    if (descriptor?.set) {
      descriptor.set.call(checkbox, wanted);
    } else {
      checkbox.checked = wanted;
    }
  }

  function findFakeCheckboxFor(checkbox) {
    const id = checkbox.getAttribute("id");
    if (id) {
      const fakeById = document.querySelector(`#fc-fake-${cssEscape(id.replace(/^field-/, ""))} .fc-fake-item`);
      if (fakeById) return fakeById;
      const fakeByDataId = document.querySelector(`[data-fc-real-item-id="${cssEscape(id)}"]`);
      if (fakeByDataId) return fakeByDataId;
    }

    const container = checkbox.closest(".ddb-homebrew-create-form-fields-item, .form-check, label, div");
    return container?.querySelector(".fc-fake-item, [role='checkbox']") || null;
  }

  function syncFakeCheckbox(fake, wanted) {
    if (!fake) return false;

    fake.setAttribute("aria-checked", wanted ? "true" : "false");
    fake.dataset.checked = wanted ? "true" : "false";
    fake.classList.toggle("checked", wanted);
    fake.classList.toggle("selected", wanted);
    fake.classList.toggle("active", wanted);
    fake.classList.toggle("is-checked", wanted);
    fake.classList.toggle("is-selected", wanted);
    fake.classList.toggle("fc-fake-item-checked", wanted);
    fake.classList.toggle("fc-fake-item-selected", wanted);

    return true;
  }

  function syncCheckboxInPageContext(checkbox, wanted) {
    setCheckboxChecked(checkbox, wanted);
    syncFakeCheckbox(findFakeCheckboxFor(checkbox), wanted);
    fireInputEvents(checkbox);
    return true;
  }

  async function fillSelectLike(report, label, value, terms, options = {}) {
    if (!value) {
      report.info(`${label}: skipped empty value.`);
      return false;
    }

    const nativeSelect = findFirstSelector(options.selectors, { allowHidden: true }) ||
      findFieldByTerms(terms, ["select"]);
    const nativeOption = nativeSelect ? selectNativeOption(nativeSelect, value) : null;
    if (nativeSelect && nativeOption) {
      fireInputEvents(nativeSelect);
      syncSelectInPageContext(nativeSelect, nativeOption.value, nativeOption.textContent || value);
      report.info(`${label}: selected "${value}" in native select.`);
      return true;
    }

    const combo = findComboboxByTerms(terms);
    if (combo && await fillCombobox(combo, value)) {
      report.info(`${label}: selected "${value}" in combobox/input.`);
      return true;
    }

    const dropdown = findDropdownButtonByTerms(terms);
    if (dropdown && await chooseFromDropdown(dropdown, value)) {
      report.info(`${label}: selected "${value}" in dropdown button.`);
      return true;
    }

    if (options.warnOnMissing !== false) {
      report.warn(`${label}: could not select "${value}".`);
    }
    return false;
  }

  async function fillDdbModifierSelect(report, label, selector, value, options = {}) {
    if (!value) {
      report.info(`${label}: skipped empty value.`);
      return null;
    }

    const select = document.querySelector(selector);
    if (!select) {
      report.warn(`${label}: D&D Beyond modifier select ${selector} not found.`);
      return null;
    }

    let option = findNativeOption(select, value);
    if (!option && selector === "#field-spell-modifier-sub-type") {
      await ensureModifierSubtypeOptionInPageContext(value, options.modifierTypeValue);
      await sleep(100);
      option = findNativeOption(select, value);
    }

    if (!option && selector === "#field-spell-modifier-sub-type") {
      option = addModifierSubtypeOption(select, value, options.modifierTypeValue);
    }

    if (!option) {
      report.warn(`${label}: could not find D&D Beyond option "${value}".`);
      return null;
    }

    setReactValue(select, option.value);
    option.selected = true;
    fireInputEvents(select);
    forceDdbSelect2Value(selector, option.value, option.textContent || value);
    syncSelectInPageContext(select, option.value, option.textContent || value);

    report.info(`${label}: selected "${option.textContent || value}" in D&D Beyond select.`);
    return option;
  }

  function addModifierSubtypeOption(select, wanted, modifierTypeValue) {
    const match = findModifierSubtypeData(wanted, modifierTypeValue);
    if (!match) return null;

    const existing = Array.from(select.options).find((option) => String(option.value) === String(match.id));
    if (existing) return existing;

    const option = document.createElement("option");
    option.value = String(match.id);
    option.textContent = match.name;
    option.dataset.modifierType = String(match.type);
    select.appendChild(option);
    return option;
  }

  function findModifierSubtypeData(wanted, modifierTypeValue) {
    const data = getModifierSubtypeData();
    const wantedText = normalize(wanted);
    const typeValue = String(modifierTypeValue || "");
    const sameType = data.filter((entry) => !typeValue || String(entry.type) === typeValue);

    return sameType.find((entry) => normalize(entry.name) === wantedText) ||
      sameType.find((entry) => normalize(entry.name).includes(wantedText) || wantedText.includes(normalize(entry.name))) ||
      data.find((entry) => normalize(entry.name) === wantedText) ||
      data.find((entry) => normalize(entry.name).includes(wantedText) || wantedText.includes(normalize(entry.name))) ||
      null;
  }

  function getModifierSubtypeData() {
    const data = window.subTypeJSON || window.__ddbHomebrewSubtypeData || [];
    const flattened = data.flat ? data.flat().filter(Boolean) : [];
    return flattened.concat([
      { id: 45, name: "Melee Weapon Attacks", type: 1 },
      { id: 1687, name: "Melee Weapon Attacks", type: 2 }
    ]);
  }

  async function waitForModifierSubtype(wanted, modifierTypeValue, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const select = document.querySelector("#field-spell-modifier-sub-type");
      if (select && (findNativeOption(select, wanted) || findModifierSubtypeData(wanted, modifierTypeValue))) return true;
      await sleep(100);
    }
    return false;
  }

  async function ensureModifierSubtypeOptionInPageContext(wanted, modifierTypeValue) {
    const select = document.querySelector("#field-spell-modifier-sub-type");
    const match = findModifierSubtypeData(wanted, modifierTypeValue);
    if (!select || !match) return false;

    let option = Array.from(select.options || []).find((candidate) => String(candidate.value) === String(match.id));
    if (!option) {
      option = new Option(match.name, String(match.id), false, false);
      select.appendChild(option);
    }

    return true;
  }

  function forceDdbSelect2Value(selector, value, text) {
    const select = document.querySelector(selector);
    if (!select) return false;

    select.value = String(value);
    Array.from(select.options || []).forEach((option) => {
      option.selected = String(option.value) === String(value);
    });

    const container = document.querySelector(`#s2id_${cssEscape(select.id)}`);
    const chosen = container?.querySelector(".select2-chosen");
    if (chosen) {
      chosen.textContent = text || "";
    }

    fireInputEvents(select);
    return true;
  }

  async function fillMultiSelectLike(report, label, values, terms, options = {}) {
    const list = values.filter(Boolean);
    if (!list.length) {
      report.info(`${label}: skipped empty value.`);
      return false;
    }

    const nativeSelect = findFirstSelector(options.selectors, { allowHidden: true }) ||
      findFieldByTerms(terms, ["select"]);
    if (!nativeSelect) {
      if (options.warnOnMissing !== false) {
        report.warn(`${label}: field not found.`);
      }
      return false;
    }

    let selected = 0;
    for (const value of list) {
      const option = findNativeOption(nativeSelect, value);
      if (!option) continue;
      option.selected = true;
      selected += 1;
    }

    if (!selected) {
      if (options.warnOnMissing !== false) {
        report.warn(`${label}: could not select "${list.join(", ")}".`);
      }
      return false;
    }

    fireInputEvents(nativeSelect);
    syncSelectInPageContext(nativeSelect, Array.from(nativeSelect.selectedOptions).map((option) => option.value), list.join(", "));
    report.info(`${label}: selected ${selected} option(s) in native multi-select.`);
    return true;
  }

  function findFieldByTerms(terms, selectors) {
    const controls = selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector))
    );

    return rankCandidates(controls, terms)[0]?.element || null;
  }

  function findFirstSelector(selectors = [], options = {}) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) continue;
      if (options.allowHidden || isUsableElement(element)) return element;
    }
    return null;
  }

  function findComboboxByTerms(terms) {
    const controls = Array.from(document.querySelectorAll(
      'input[role="combobox"], input[aria-autocomplete], [role="combobox"], input[class*="select"], input[id*="select"]'
    ));
    return rankCandidates(controls, terms)[0]?.element || null;
  }

  function findDropdownButtonByTerms(terms) {
    const buttons = Array.from(document.querySelectorAll(
      'button, [role="button"], [aria-haspopup="listbox"], [aria-haspopup="menu"]'
    ));
    return rankCandidates(buttons, terms)[0]?.element || null;
  }

  function rankCandidates(elements, terms) {
    const normalizedTerms = terms.map(normalize).filter(Boolean);

    return elements
      .filter(isUsableElement)
      .map((element) => {
        const haystack = collectContextText(element);
        let score = 0;
        for (const term of normalizedTerms) {
          if (haystack.exact.includes(term)) score += 10;
          if (haystack.near.includes(term)) score += 4;
          if (haystack.attributes.includes(term)) score += 6;
        }
        return { element, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  function collectContextText(element) {
    const labels = [];
    const id = element.getAttribute("id");
    if (id) {
      labels.push(...Array.from(document.querySelectorAll(`label[for="${cssEscape(id)}"]`)).map((node) => node.textContent || ""));
    }

    const wrappingLabel = element.closest("label");
    if (wrappingLabel) labels.push(wrappingLabel.textContent || "");

    const fieldContainer = element.closest(".form-group, .field, .input, .ddb-form-field, div, li, section");
    const parentText = fieldContainer?.textContent || "";

    const attributeText = [
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
      element.getAttribute("data-testid"),
      element.getAttribute("class")
    ].filter(Boolean).join(" ");

    return {
      exact: normalize(labels.join(" ")),
      near: normalize(parentText),
      attributes: normalize(attributeText)
    };
  }

  function selectNativeOption(select, wanted) {
    const option = findNativeOption(select, wanted);
    if (!option) return false;
    setReactValue(select, option.value);
    return option;
  }

  function findNativeOption(select, wanted) {
    const wantedText = normalize(wanted);
    const options = Array.from(select.options);
    return options.find((candidate) =>
      normalize(candidate.textContent) === wantedText ||
      normalize(candidate.value) === wantedText
    ) || options.find((candidate) => {
      const optionText = normalize(candidate.textContent);
      return optionText && (
        optionText.includes(wantedText) ||
        wantedText.includes(optionText)
      );
    }) || null;
  }

  async function waitForNativeOption(selector, wanted, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const select = document.querySelector(selector);
      if (select && findNativeOption(select, wanted)) return true;
      await sleep(100);
    }
    return false;
  }

  function syncSelectInPageContext(select, value, text) {
    if (Array.isArray(value)) {
      Array.from(select.options || []).forEach((option) => {
        option.selected = value.includes(option.value);
      });
    } else {
      select.value = value;
      Array.from(select.options || []).forEach((option) => {
        option.selected = String(option.value) === String(value);
      });
    }

    const container = select.id ? document.querySelector(`#s2id_${cssEscape(select.id)}`) : null;
    const chosen = container?.querySelector(".select2-chosen");
    if (chosen && text) chosen.textContent = text;

    fireInputEvents(select);
    return true;
  }

  async function fillCombobox(combo, value) {
    combo.click();
    await sleep(80);
    setReactValue(combo, String(value));
    fireInputEvents(combo);
    await sleep(250);
    return clickVisibleOption(value);
  }

  async function chooseFromDropdown(button, value) {
    button.click();
    await sleep(250);
    return clickVisibleOption(value);
  }

  function clickVisibleOption(value) {
    const wanted = normalize(value);
    const candidates = Array.from(document.querySelectorAll(
      '[role="option"], [role="menuitem"], li, button, a, div'
    ));

    const option = candidates.find((node) =>
      isUsableElement(node) && normalize(node.textContent) === wanted
    ) || candidates.find((node) =>
      isUsableElement(node) && normalize(node.textContent).includes(wanted)
    );

    if (!option) return false;
    option.click();
    option.dispatchEvent(new Event("change", { bubbles: true }));
    option.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function setReactValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function setTextLikeValue(element, value) {
    if (element instanceof HTMLElement && element.isContentEditable) {
      element.focus();
      element.textContent = value;
      return;
    }

    setReactValue(element, value);
  }

  function fireInputEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function setTinyMceContent(editorId, html) {
    let filled = false;

    // TinyMCE stores the visible editor in a same-origin iframe. Updating the
    // iframe body avoids inline script injection, which Chrome blocks under CSP.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const iframeFilled = setTinyMceIframeBody(`${editorId}_ifr`, html);
      filled = iframeFilled || filled;
      if (iframeFilled) break;
      await sleep(100);
    }

    const textarea = document.querySelector(`#${cssEscape(editorId)}`);
    if (textarea) {
      setTextLikeValue(textarea, html);
      fireInputEvents(textarea);
      filled = true;
    }

    return filled;
  }

  function setTinyMceIframeBody(iframeId, html) {
    try {
      const iframe = document.querySelector(`#${cssEscape(iframeId)}`);
      const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
      const body = doc?.body;
      if (!body) return false;

      body.innerHTML = html;
      body.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: htmlToPlainText(html) }));
      body.dispatchEvent(new Event("change", { bubbles: true }));
      body.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function buildMagicItemDescriptionHtml(item) {
    const sections = [];

    if (item.description) {
      sections.push(paragraphsToHtml(item.description));
    }

    if (item.damage?.dice || item.damage?.type || item.properties?.length || item.baseWeapon || item.baseArmor || item.magicItemType) {
      const details = [];
      if (item.baseWeapon) {
        details.push(`<li><strong>Base Weapon:</strong> ${escapeHtml(item.baseWeapon)}</li>`);
      }
      if (item.baseArmor) {
        details.push(`<li><strong>Base Armor:</strong> ${escapeHtml(item.baseArmor)}</li>`);
      }
      if (item.magicItemType) {
        details.push(`<li><strong>Magic Item Type:</strong> ${escapeHtml(item.magicItemType)}</li>`);
      }
      if (item.dexBonus) {
        details.push(`<li><strong>Dex Bonus:</strong> ${escapeHtml(item.dexBonus)}</li>`);
      }
      if (item.strengthRequirement) {
        details.push(`<li><strong>Strength Requirement:</strong> ${escapeHtml(item.strengthRequirement)}</li>`);
      }
      if (item.stealthCheck) {
        details.push(`<li><strong>Stealth Check:</strong> ${escapeHtml(item.stealthCheck)}</li>`);
      }
      if (item.damage?.dice || item.damage?.type) {
        details.push(`<li><strong>Damage:</strong> ${escapeHtml([item.damage?.dice, item.damage?.type].filter(Boolean).join(" "))}</li>`);
      }
      if (item.properties?.length) {
        details.push(`<li><strong>Properties:</strong> ${escapeHtml(item.properties.join(", "))}</li>`);
      }
      sections.push(`<h3>Item Details</h3><ul>${details.join("")}</ul>`);
    }

    const actions = getItemActions(item);
    if (actions.length) {
      for (const action of actions) {
        const meta = [
          action.activation,
          Number.isFinite(Number(action.uses)) ? `${action.uses} Uses` : null,
          action.reset
        ].filter(Boolean).join(", ");

        sections.push([
          `<h3>${escapeHtml(action.name || "Special Action")}</h3>`,
          meta ? `<p><strong>${escapeHtml(meta)}</strong></p>` : "",
          action.description ? paragraphsToHtml(action.description) : ""
        ].join(""));
      }
    }

    return sections.filter(Boolean).join("<hr>");
  }

  function getItemActions(item) {
    if (Array.isArray(item.actions)) {
      return item.actions.filter(Boolean);
    }

    // Backward compatibility for older local JSON examples. Prefer `actions`.
    return item.ashOfWar ? [item.ashOfWar] : [];
  }

  function formatActionText(action) {
    return [
      action.name ? `${action.name}` : null,
      action.activation ? `Activation: ${action.activation}` : null,
      Number.isFinite(Number(action.uses)) ? `Uses: ${action.uses}` : null,
      action.reset ? `Reset: ${action.reset}` : null,
      action.description || null
    ].filter(Boolean).join("\n");
  }

  function formatConditionSummary(condition) {
    return [
      condition.condition || condition.name,
      condition.duration !== undefined ? condition.duration : null,
      condition.durationUnit,
      condition.details || condition.exception
    ].filter(Boolean).join(" - ");
  }

  function formatModifierSummary(modifier) {
    return [
      [modifier.type, modifier.subType || modifier.subtype].filter(Boolean).join(" - "),
      modifier.value !== undefined ? `Value: ${modifier.value}` : null,
      modifier.diceCount && (modifier.dieType || modifier.diceType) ? `Dice: ${modifier.diceCount}${modifier.dieType || modifier.diceType}` : null,
      modifier.details || modifier.restriction
    ].filter(Boolean).join(" - ");
  }

  function formatSpellSummary(spell) {
    return [
      spell.name || spell.spellName,
      spell.minCharges !== undefined || spell.maxCharges !== undefined
        ? `Charges: ${spell.minCharges ?? ""}-${spell.maxCharges ?? ""}`
        : null,
      spell.saveDc !== undefined ? `Save DC: ${spell.saveDc}` : null,
      spell.castAtLevel ? `Cast Level: ${spell.castAtLevel}` : null
    ].filter(Boolean).join(" - ");
  }

  function formatHigherLevelSummary(higherLevel) {
    return [
      higherLevel.level !== undefined || higherLevel.scalingLevel !== undefined ? `Level: ${higherLevel.level ?? higherLevel.scalingLevel}` : null,
      higherLevel.effect || higherLevel.scaleEffect,
      higherLevel.diceCount && (higherLevel.dieType || higherLevel.diceType) ? `Dice: ${higherLevel.diceCount}${higherLevel.dieType || higherLevel.diceType}` : null,
      higherLevel.fixedValue !== undefined || higherLevel.value !== undefined ? `Value: ${higherLevel.fixedValue ?? higherLevel.value}` : null,
      higherLevel.details
    ].filter(Boolean).join(" - ");
  }

  function paragraphsToHtml(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/<[a-z][\s\S]*>/i.test(text)) return text;
    return text
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  function htmlToPlainText(html) {
    const node = document.createElement("div");
    node.innerHTML = html;
    return node.textContent || "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isUsableElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.matches("[disabled], [aria-disabled='true']")) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function describeElement(element) {
    const bits = [element.tagName.toLowerCase()];
    if (element.id) bits.push(`#${element.id}`);
    if (element instanceof HTMLElement && element.isContentEditable) bits.push("[contenteditable]");
    if (element.getAttribute("name")) bits.push(`[name="${element.getAttribute("name")}"]`);
    if (element.getAttribute("placeholder")) bits.push(`[placeholder="${element.getAttribute("placeholder")}"]`);
    return bits.join("");
  }

  function selectorForElement(element) {
    if (element.id) return `#${cssEscape(element.id)}`;
    const name = element.getAttribute("name");
    if (name) return `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
    return "";
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? text[0].toUpperCase() + text.slice(1) : text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForPageToSettle() {
    await sleep(250);
  }

  async function waitForSelector(selector, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (document.querySelector(selector)) return true;
      await sleep(100);
    }
    return false;
  }

  function createReport() {
    const entries = [];
    return {
      entries,
      summary: "",
      info(message) {
        console.info(LOG_PREFIX, message);
        entries.push({ level: "info", message });
      },
      warn(message) {
        console.info(LOG_PREFIX, `WARN: ${message}`);
        entries.push({ level: "warn", message });
      }
    };
  }

  function summarize(entries) {
    const warnings = entries.filter((entry) => entry.level === "warn").length;
    return warnings
      ? `${warnings} warning(s). Review the fields listed above before saving.`
      : "No warnings reported. Review the page before saving.";
  }
})();
