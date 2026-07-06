const textarea = document.querySelector("#item-json");
const importButton = document.querySelector("#import-button");
const clearButton = document.querySelector("#clear-button");
const copyLogButton = document.querySelector("#copy-log-button");
const statusNode = document.querySelector("#status");
const logNode = document.querySelector("#log");
const versionBadge = document.querySelector("#version-badge");
const autoNavigateSubpages = document.querySelector("#auto-navigate-subpages");
const autoSaveSubpages = document.querySelector("#auto-save-subpages");

const STORAGE_KEY = "dndbeyond-homebrew-importer:last-json";
const OPTIONS_STORAGE_KEY = "dndbeyond-homebrew-importer:options";

const manifest = chrome.runtime.getManifest();
versionBadge.textContent = `v${manifest.version}`;
versionBadge.title = `${manifest.name} ${manifest.version}`;

const sampleItem = {
  type: "weapon",
  name: "Radiant Oath Longsword",
  baseWeapon: "Longsword",
  rarity: "Very Rare",
  requiresAttunement: true,
  attunementDescription: "creature proficient with longswords",
  damage: {
    dice: "1d8",
    type: "Slashing"
  },
  properties: ["Versatile"],
  description: "This polished longsword carries a warm inner light along its fuller. While attuned to it, the wielder can channel that light into oaths of protection and precise strikes.",
  notes: "Stress-test item for local importer validation. Do not publish without review.",
  actions: [
    {
      name: "Radiant Oath",
      activation: "Action",
      uses: 3,
      reset: "Long Rest",
      description: "For 1 minute, the sword sheds bright light in a 20-foot radius and dim light for an additional 20 feet. Once on each of your turns when you hit with this weapon, you can deal an extra 1d6 radiant damage."
    },
    {
      name: "Guarding Flare",
      activation: "Reaction",
      uses: 1,
      reset: "Short Rest",
      description: "When a creature you can see within 10 feet of you is hit by an attack, you can impose a -2 penalty on the attack roll, potentially causing the attack to miss."
    }
  ],
  modifiers: [
    {
      type: "Bonus",
      subType: "Melee Weapon Attacks",
      value: 1,
      details: "Applies a +1 bonus to melee weapon attack rolls made with this weapon."
    },
    {
      type: "Damage",
      subType: "Radiant",
      diceCount: 1,
      dieType: "d6",
      details: "Extra radiant damage while Radiant Oath is active."
    }
  ],
  conditions: [
    {
      condition: "Blinded",
      duration: 1,
      durationUnit: "Round",
      details: "A creature hit by a critical hit from the activated weapon can be blinded until the end of its next turn, at the DM's discretion."
    }
  ],
  spells: [
    {
      name: "Bless",
      minCharges: 1,
      maxCharges: 1,
      saveDc: 15,
      castAtLevel: "1",
      details: "You can expend 1 charge to cast Bless from the sword. The spell requires no material components."
    }
  ]
};

chrome.storage?.local?.get?.(STORAGE_KEY, (stored) => {
  textarea.value = stored?.[STORAGE_KEY] || JSON.stringify(sampleItem, null, 2);
});

chrome.storage?.local?.get?.(OPTIONS_STORAGE_KEY, (stored) => {
  const options = stored?.[OPTIONS_STORAGE_KEY] || {};
  autoNavigateSubpages.checked = Boolean(options.autoNavigateSubpages);
  autoSaveSubpages.checked = Boolean(options.autoSaveSubpages);
});

textarea.addEventListener("input", () => {
  chrome.storage?.local?.set?.({ [STORAGE_KEY]: textarea.value });
  setStatus("", "");
});

autoNavigateSubpages.addEventListener("change", persistOptions);
autoSaveSubpages.addEventListener("change", persistOptions);

clearButton.addEventListener("click", () => {
  textarea.value = "";
  logNode.textContent = "";
  chrome.storage?.local?.remove?.(STORAGE_KEY);
  setStatus("JSON cleared.", "");
});

copyLogButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(logNode.textContent || "");
  setStatus("Log copied.", "success");
});

importButton.addEventListener("click", async () => {
  logNode.textContent = "";

  const parsed = parseItemJson(textarea.value);
  if (!parsed.ok) {
    setStatus(parsed.error, "error");
    return;
  }

  setStatus("Importing into the active D&D Beyond tab...", "");
  importButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "DNDBEYOND_IMPORT_ITEM",
      payload: {
        item: parsed.value,
        options: getImportOptions()
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The content script did not return an import result.");
    }

    renderLog(response.report);
    setStatus(
      response.report?.finalMessage || "Import abgeschlossen. Bitte kontrollieren und manuell speichern.",
      "success"
    );
  } catch (error) {
    setStatus(
      "Import failed. Open a D&D Beyond homebrew item page, then try again.",
      "error"
    );
    appendLog(`ERROR: ${error.message}`);
  } finally {
    importButton.disabled = false;
  }
});

function parseItemJson(source) {
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "JSON must be a single item object." };
    }
    if (!value.name || typeof value.name !== "string") {
      return { ok: false, error: "JSON needs a string field: name." };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${error.message}` };
  }
}

function renderLog(report) {
  const lines = [];
  for (const entry of report?.entries || []) {
    lines.push(`${entry.level.toUpperCase()}: ${entry.message}`);
  }
  if (report?.summary) {
    lines.push("");
    lines.push(report.summary);
  }
  logNode.textContent = lines.join("\n");
}

function appendLog(line) {
  logNode.textContent = `${logNode.textContent}${logNode.textContent ? "\n" : ""}${line}`;
}

function setStatus(message, className) {
  statusNode.textContent = message;
  statusNode.className = `status${className ? ` ${className}` : ""}`;
}

function getImportOptions() {
  return {
    autoNavigateSubpages: autoNavigateSubpages.checked,
    autoSaveSubpages: autoSaveSubpages.checked
  };
}

function persistOptions() {
  chrome.storage?.local?.set?.({ [OPTIONS_STORAGE_KEY]: getImportOptions() });
}
