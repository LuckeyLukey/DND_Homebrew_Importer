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

    report.info(`Starting local import for "${item.name || "unnamed item"}".`);
    report.info(`Detected D&D Beyond phase: ${pagePhase}.`);
    await waitForPageToSettle();

    if (isModifierPage()) {
      await fillModifierPage(report, item.modifiers?.[0]);
      report.info("Modifier import abgeschlossen. Bitte kontrollieren und manuell speichern.");
      report.finalMessage = "Modifier import abgeschlossen. Bitte kontrollieren und manuell speichern.";
      report.summary = summarize(report.entries);
      return report;
    }

    if (isConditionPage()) {
      await fillConditionPage(report, item.conditions?.[0]);
      report.info("Condition import abgeschlossen. Bitte kontrollieren und manuell speichern.");
      report.finalMessage = "Condition import abgeschlossen. Bitte kontrollieren und manuell speichern.";
      report.summary = summarize(report.entries);
      return report;
    }

    if (isSpellPage()) {
      await fillSpellPage(report, item.spells?.[0]);
      report.info("Spell import abgeschlossen. Bitte kontrollieren und manuell speichern.");
      report.finalMessage = "Spell import abgeschlossen. Bitte kontrollieren und manuell speichern.";
      report.summary = summarize(report.entries);
      return report;
    }

    await fillTextField(report, "Name", item.name, ["name", "item name"], {
      selectors: ["#field-name"]
    });
    await fillSelectLike(report, "Item Base Type", item.type === "weapon" ? "Weapon" : undefined, [
      "item base type",
      "base type"
    ], {
      selectors: ["#field-item-base-type"],
      warnOnMissing: false
    });
    await fillSelectLike(report, "Base Weapon", item.baseWeapon, [
      "base weapon",
      "base item",
      "weapon"
    ], {
      selectors: ["#field-base-weapon"]
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

    if (item.modifiers?.length) {
      await fillModifiers(report, item.modifiers);
    }

    if (item.conditions?.length) {
      await reportSeparateCreatePage(report, "Conditions", "condition", findConditionCreateUrl(), item.conditions.map(formatConditionSummary));
    }

    if (item.spells?.length) {
      await reportSeparateCreatePage(report, "Spells", "spell", findSpellCreateUrl(), item.spells.map(formatSpellSummary));
    }

    if (options.autoNavigateSubpages) {
      const started = await startSubpageWorkflow(report, item, options);
      if (started) {
        report.finalMessage = options.autoSaveSubpages
          ? "Unterseiten-Workflow gestartet. Modifier, Conditions und Spells werden automatisch erstellt und gespeichert."
          : "Unterseiten-Workflow gestartet. Die erste Unterseite wird geöffnet und ausgefüllt; bitte dort manuell speichern.";
        report.summary = summarize(report.entries);
        return report;
      }
    }

    report.info("Import abgeschlossen. Bitte kontrollieren und manuell speichern.");
    report.finalMessage = "Import abgeschlossen. Bitte kontrollieren und manuell speichern.";
    report.summary = summarize(report.entries);
    return report;
  }

  async function resumeStoredWorkflow() {
    await waitForPageToSettle();
    const state = await getStoredWorkflow();
    if (!state?.active || !state.item) return;

    const report = createReport();

    if (isModifierPage() || isConditionPage() || isSpellPage()) {
      await runWorkflowSubpage(report, state);
      return;
    }

    if (isMagicItemEditPage()) {
      await continueWorkflowFromEditPage(report, state);
    }
  }

  async function startSubpageWorkflow(report, item, options) {
    const queue = buildSubpageQueue(item);
    if (!queue.length) {
      report.info("Automatic subpage workflow: no modifier, condition, or spell entries found.");
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

  function buildSubpageQueue(item) {
    return [
      ...buildEntries("modifier", item.modifiers, findModifierCreateUrl()),
      ...buildEntries("condition", item.conditions, findConditionCreateUrl()),
      ...buildEntries("spell", item.spells, findSpellCreateUrl())
    ];
  }

  function buildEntries(kind, values, url) {
    if (!Array.isArray(values)) return [];
    return values.map((_value, index) => ({ kind, index, url }));
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
    return "";
  }

  async function runWorkflowSubpage(report, state) {
    const entry = state.activeEntry;
    if (!entry) return;

    const expectedPage = (entry.kind === "modifier" && isModifierPage()) ||
      (entry.kind === "condition" && isConditionPage()) ||
      (entry.kind === "spell" && isSpellPage());
    if (!expectedPage) return;

    report.info(`Automatic subpage workflow: filling ${entry.kind} ${entry.index + 1}.`);
    const filled = await fillWorkflowEntry(report, state.item, entry);
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

  async function fillWorkflowEntry(report, item, entry) {
    if (entry.kind === "modifier") {
      return fillModifierPage(report, item.modifiers?.[entry.index]);
    }
    if (entry.kind === "condition") {
      return fillConditionPage(report, item.conditions?.[entry.index]);
    }
    if (entry.kind === "spell") {
      return fillSpellPage(report, item.spells?.[entry.index]);
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
    return detectPagePhase() === "edit" && !isModifierPage() && !isConditionPage() && !isSpellPage();
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

  function isModifierPage() {
    return window.location.pathname.toLowerCase().includes("/modifier/");
  }

  function isConditionPage() {
    return window.location.pathname.toLowerCase().includes("/condition/");
  }

  function isSpellPage() {
    return window.location.pathname.toLowerCase().includes("/spell/");
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

    if (modifier.value !== undefined) {
      filled = await fillTextField(report, "Modifier Value", String(modifier.value), [
        "fixed value",
        "value",
        "bonus",
        "amount"
      ], {
        selectors: ["#field-fixed-value"],
        warnOnMissing: false
      }) || filled;
    }

    if (modifier.diceCount !== undefined) {
      filled = await fillTextField(report, "Modifier Dice Count", String(modifier.diceCount), [
        "dice count"
      ], {
        selectors: ["#field-dice-count"],
        warnOnMissing: false
      }) || filled;
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

    if (modifier.durationInterval !== undefined) {
      filled = await fillTextField(report, "Modifier Duration Interval", String(modifier.durationInterval), [
        "duration interval"
      ], {
        selectors: ["#field-duration-interval"],
        warnOnMissing: false
      }) || filled;
    }

    filled = await fillSelectLike(report, "Modifier Duration Unit", modifier.durationUnit, [
      "duration unit"
    ], {
      selectors: ["#field-duration-unit"],
      warnOnMissing: false
    }) || filled;

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
    filled = await fillSelectLike(report, "Condition", condition.condition || condition.name, [
      "condition"
    ], {
      selectors: ["#field-item-condition"]
    }) || filled;

    if (condition.duration !== undefined) {
      filled = await fillTextField(report, "Condition Duration", String(condition.duration), [
        "condition duration",
        "duration"
      ], {
        selectors: ["#field-condition-duration"],
        warnOnMissing: false
      }) || filled;
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
    const selector = selectorForElement(checkbox);
    if (!selector) return false;

    const script = document.createElement("script");
    script.textContent = `
      (() => {
        const selector = ${JSON.stringify(selector)};
        const wanted = ${JSON.stringify(wanted)};
        const checkbox = document.querySelector(selector);
        if (!checkbox) return;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
        if (descriptor && descriptor.set) {
          descriptor.set.call(checkbox, wanted);
        } else {
          checkbox.checked = wanted;
        }
        checkbox.dispatchEvent(new Event("input", { bubbles: true }));
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        checkbox.dispatchEvent(new Event("blur", { bubbles: true }));
        const fake = document.querySelector("#fc-fake-" + checkbox.id.replace(/^field-/, "") + " .fc-fake-item");
        if (fake) {
          fake.setAttribute("aria-checked", wanted ? "true" : "false");
          fake.dataset.checked = wanted ? "true" : "false";
          ["checked", "selected", "active", "is-checked", "is-selected", "fc-fake-item-checked", "fc-fake-item-selected"].forEach((className) => {
            fake.classList.toggle(className, wanted);
          });
        }
        const jq = window.jQuery || window.$;
        if (jq) {
          jq(checkbox).prop("checked", wanted).trigger("input").trigger("change").trigger("blur");
        }
      })();
    `;

    try {
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      return true;
    } catch (_error) {
      script.remove();
      return false;
    }
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
    const script = document.createElement("script");
    script.textContent = `
      (() => {
        const wanted = ${JSON.stringify(wanted)};
        const modifierTypeValue = ${JSON.stringify(modifierTypeValue || "")};
        const normalize = (value) => String(value || "")
          .toLowerCase()
          .replace(/['"]/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\\s+/g, " ")
          .trim();
        const data = (window.subTypeJSON || window.__ddbHomebrewSubtypeData || []).flat
          ? (window.subTypeJSON || window.__ddbHomebrewSubtypeData || []).flat()
          : [];
        const fallback = [
          { id: 45, name: "Melee Weapon Attacks", type: 1 },
          { id: 1687, name: "Melee Weapon Attacks", type: 2 }
        ];
        const entries = data.concat(fallback).filter(Boolean);
        const wantedText = normalize(wanted);
        const sameType = entries.filter((entry) => !modifierTypeValue || String(entry.type) === String(modifierTypeValue));
        const match = sameType.find((entry) => normalize(entry.name) === wantedText) ||
          sameType.find((entry) => normalize(entry.name).includes(wantedText) || wantedText.includes(normalize(entry.name))) ||
          entries.find((entry) => normalize(entry.name) === wantedText) ||
          entries.find((entry) => normalize(entry.name).includes(wantedText) || wantedText.includes(normalize(entry.name)));
        const select = document.querySelector("#field-spell-modifier-sub-type");
        if (!select || !match) return;
        let option = Array.from(select.options || []).find((candidate) => String(candidate.value) === String(match.id));
        if (!option) {
          option = new Option(match.name, String(match.id), false, false);
          select.appendChild(option);
        }
      })();
    `;

    try {
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      return true;
    } catch (_error) {
      script.remove();
      return false;
    }
  }

  function forceDdbSelect2Value(selector, value, text) {
    const select = document.querySelector(selector);
    if (!select) return false;

    const container = document.querySelector(`#s2id_${cssEscape(select.id)}`);
    const chosen = container?.querySelector(".select2-chosen");
    if (chosen) {
      chosen.textContent = text || "";
    }

    const script = document.createElement("script");
    script.textContent = `
      (() => {
        const selector = ${JSON.stringify(selector)};
        const value = ${JSON.stringify(value)};
        const text = ${JSON.stringify(text)};
        const select = document.querySelector(selector);
        if (!select) return;
        select.value = String(value);
        Array.from(select.options || []).forEach((option) => {
          option.selected = String(option.value) === String(value);
        });
        const container = document.querySelector("#s2id_" + select.id);
        const chosen = container && container.querySelector(".select2-chosen");
        if (chosen) chosen.textContent = text || "";
        const jq = window.jQuery || window.$;
        if (jq) {
          const wrapped = jq(select);
          if (wrapped.select2) {
            try { wrapped.select2("val", String(value)); } catch (_error) {}
          }
          wrapped.val(String(value));
          wrapped.trigger("input");
          wrapped.trigger("change");
        }
      })();
    `;

    try {
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      return true;
    } catch (_error) {
      script.remove();
      return false;
    }
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
    const selector = selectorForElement(select);
    if (!selector) return false;

    const script = document.createElement("script");
    script.textContent = `
      (() => {
        const selector = ${JSON.stringify(selector)};
        const value = ${JSON.stringify(value)};
        const text = ${JSON.stringify(text)};
        const select = document.querySelector(selector);
        if (!select) return;

        const setValue = () => {
          if (Array.isArray(value)) {
            Array.from(select.options || []).forEach((option) => {
              option.selected = value.includes(option.value);
            });
          } else {
            select.value = value;
          }
        };

        setValue();
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.dispatchEvent(new Event("blur", { bubbles: true }));

        const jq = window.jQuery || window.$;
        if (jq) {
          const wrapped = jq(select);
          wrapped.val(value);
          wrapped.trigger("input");
          wrapped.trigger("change");
          wrapped.trigger({
            type: "select2:select",
            params: {
              data: { id: value, text }
            }
          });
        }
      })();
    `;

    try {
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      return true;
    } catch (_error) {
      script.remove();
      return false;
    }
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

    // Content scripts run in an isolated world, so page-level TinyMCE is not
    // always directly visible here. A short page script reaches the real editor
    // instance when the site's CSP allows it.
    filled = injectPageTinyMceUpdate(editorId, html) || filled;

    // TinyMCE stores the visible editor in a same-origin iframe. Updating the
    // iframe body keeps the visible editor and tinyMCE.triggerSave() aligned.
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

  function injectPageTinyMceUpdate(editorId, html) {
    const script = document.createElement("script");
    script.textContent = `
      (() => {
        const editorId = ${JSON.stringify(editorId)};
        const html = ${JSON.stringify(html)};
        const tinyMce = window.tinyMCE || window.tinymce;
        const editor = tinyMce && tinyMce.get && tinyMce.get(editorId);
        if (!editor) return;
        editor.setContent(html);
        editor.save();
        if (editor.fire) {
          editor.fire("input");
          editor.fire("change");
          editor.fire("blur");
        }
      })();
    `;

    try {
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      return true;
    } catch (_error) {
      script.remove();
      return false;
    }
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

    if (item.damage?.dice || item.damage?.type || item.properties?.length) {
      const details = [];
      if (item.damage?.dice || item.damage?.type) {
        details.push(`<li><strong>Damage:</strong> ${escapeHtml([item.damage?.dice, item.damage?.type].filter(Boolean).join(" "))}</li>`);
      }
      if (item.properties?.length) {
        details.push(`<li><strong>Properties:</strong> ${escapeHtml(item.properties.join(", "))}</li>`);
      }
      sections.push(`<h3>Weapon Details</h3><ul>${details.join("")}</ul>`);
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
        console.warn(LOG_PREFIX, message);
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
