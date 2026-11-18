/**
 * Awakened Dreaming — custom PC sheet for the Cypher System (mrkwnzl) on Foundry VTT.
 *
 * The sheet extends the system's own PC sheet class, so rolls, pool controls, item lists,
 * drag & drop and settings keep working. On top of that it follows the table's house rules:
 *   - Recovery: one 1-turn roll, two Respite rolls, one Long Rest roll
 *   - Effort: a daily budget equal to Tier, restored by the Long Rest
 *   - Up to six Awakenings, each with its own Aura, Bleed-through, Focus and Tier
 *   - Morph tracker (2 XP per attempt, 3 successes, difficulty 6 easing by 1 per attempt)
 *   - Cyphers are called Bulans
 *   - Abilities can cost points from more than one pool (Edge applies to each pool)
 *   - Stacked actions: costs of several abilities are totalled per pool before Edge comes off
 *   - A pool can't go below 0: the missing points are paid with XP instead (after asking)
 *
 * Homebrew data lives in actor flags under "awakened-dreaming-sheet". Recovery rolls reuse the
 * system's own recovery fields, so nothing is lost if the module is ever turned off.
 */

const MODULE_ID = "awakened-dreaming-sheet";
const TEMPLATE_ROOT = `modules/${MODULE_ID}/templates`;
const FLAG = `flags.${MODULE_ID}`;

/* The house-rule recovery rolls, mapped onto the system's recovery fields. */
const RECOVERY_KINDS = [
  {id: "turn", label: "AWAKENED.RecoveryTurn", keys: ["oneAction"]},
  {id: "respite", label: "AWAKENED.RecoveryRespite", keys: ["tenMinutes", "tenMinutes2"]},
  {id: "longRest", label: "AWAKENED.RecoveryLongRest", keys: ["tenHours"], restoresEffort: true}
];

/* House rule: recovery rolls are 1d4. Characters still on the Cypher System's default formula
   (1d6+1, or empty) use 1d4; a formula typed on the sheet always wins. */
const HOUSE_RECOVERY = "1d4";
const SYSTEM_DEFAULT_RECOVERY = "1d6+1";
function recoveryFormula(actor) {
  const f = (actor.system.combat.recoveries.roll ?? "").trim();
  return (!f || f === SYSTEM_DEFAULT_RECOVERY) ? HOUSE_RECOVERY : f;
}

/* Split ability costs: points from Might, Speed and Intellect on one ability.
   Stored in item flags; the system's own cost/pool fields are kept in step so single-pool
   abilities keep working with every Cypher System feature. */
const SPLIT_POOLS = ["might", "speed", "intellect"];
const POOL_NAME = {might: "Might", speed: "Speed", intellect: "Intellect"};
const POOL_KEY = {Might: "might", Speed: "speed", Intellect: "intellect"};

function getSplitCost(item) {
  const f = item.flags?.[MODULE_ID]?.splitCost;
  if (f) return {might: Number(f.might) || 0, speed: Number(f.speed) || 0, intellect: Number(f.intellect) || 0};
  const out = {might: 0, speed: 0, intellect: 0};
  const cost = parseInt(item.system?.basic?.cost) || 0;
  const key = POOL_KEY[item.system?.basic?.pool];
  if (cost > 0 && key) out[key] = cost;
  return out;
}
function isPassive(item) {
  return item?.type === "ability" && !!item.flags?.[MODULE_ID]?.passive;
}
/** "Player picks one pool": the cost boxes are alternatives, e.g. 2 Might OR 2 Speed. */
function isChoiceCost(item) {
  if (item?.type !== "ability" || !item.flags?.[MODULE_ID]?.choosePool) return false;
  const s = getSplitCost(item);
  return SPLIT_POOLS.filter(k => s[k] > 0).length > 1;
}
function choiceCostLabel(split) {
  const or = ` ${game.i18n.localize("AWAKENED.Or")} `;
  return SPLIT_POOLS.filter(k => split[k] > 0)
    .map(k => `${split[k]} ${game.i18n.localize(`CYPHERSYSTEM.${POOL_NAME[k]}`)}`).join(or);
}
function isSplitCost(item) {
  if (item.type !== "ability" || isChoiceCost(item)) return false;
  const s = getSplitCost(item);
  return SPLIT_POOLS.filter(k => s[k] > 0).length > 1;
}
function splitCostLabel(split) {
  return SPLIT_POOLS.filter(k => split[k] > 0)
    .map(k => `${split[k]} ${game.i18n.localize(`CYPHERSYSTEM.${POOL_NAME[k]}`)}`).join(", ");
}
async function setSplitCost(item, split, choose) {
  const used = SPLIT_POOLS.filter(k => split[k] > 0);
  const update = {[`flags.${MODULE_ID}.splitCost`]: split};
  if (choose !== undefined) update[`flags.${MODULE_ID}.choosePool`] = !!choose;
  if (used.length === 1) {
    update["system.basic.cost"] = String(split[used[0]]);
    update["system.basic.pool"] = POOL_NAME[used[0]];
  } else if (used.length === 0) {
    update["system.basic.cost"] = "0";
  } else {
    // The sheet shows and pays split costs itself; the system field stays empty so it never
    // charges the whole cost to one pool.
    update["system.basic.cost"] = "";
    update["system.basic.pool"] = POOL_NAME[used[0]];
  }
  return item.update(update);
}
function setting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); } catch (e) { return fallback; }
}

async function confirmDialog(title, content) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2?.confirm) return DialogV2.confirm({window: {title}, content, rejectClose: false});
  return Dialog.confirm({title, content});
}

/**
 * Work out a payment of `net` points per pool (Edge already taken off).
 * House rule: if a pool would go below 0, it drops to 0 and the missing points are paid with XP
 * (after asking). Returns {update, xpSpent, shortfall} or null if the payment can't or won't happen.
 */
async function resolvePayment(actor, net) {
  let ruleBreaking = false;
  try { ruleBreaking = game.settings.get("cyphersystem", "ruleBreakingRolls"); } catch (e) { /* ignore */ }
  const update = {};
  const shortfall = {};
  for (const k of SPLIT_POOLS) {
    const n = net[k] || 0;
    if (!n) continue;
    const value = Number(actor.system.pools[k].value) || 0;
    if (n > value && !ruleBreaking) {
      shortfall[k] = n - Math.max(0, value);
      update[`system.pools.${k}.value`] = Math.min(value, 0) < 0 ? value : 0;
    } else {
      update[`system.pools.${k}.value`] = value - n;
    }
  }
  const missing = Object.values(shortfall).reduce((a, b) => a + b, 0);
  let xpSpent = 0;
  if (missing > 0) {
    const firstShort = SPLIT_POOLS.find(k => shortfall[k]);
    if (!setting("xpFallback", true)) {
      ui.notifications.info(game.i18n.localize(`CYPHERSYSTEM.NotEnough${POOL_NAME[firstShort]}`));
      return null;
    }
    const rate = Number(setting("xpPerPoint", 1)) || 1;
    xpSpent = missing * rate;
    const xp = Number(actor.system.basic.xp) || 0;
    const shortLabel = splitCostLabel({might: 0, speed: 0, intellect: 0, ...shortfall});
    if (xpSpent > xp) {
      ui.notifications.warn(game.i18n.format("AWAKENED.XPNotEnough", {name: actor.name, short: shortLabel, xp: xpSpent, have: xp}));
      return null;
    }
    const ok = await confirmDialog(
      game.i18n.localize("AWAKENED.XPCoverTitle"),
      `<p>${game.i18n.format("AWAKENED.XPCoverText", {name: actor.name, short: shortLabel, xp: xpSpent, have: xp})}</p>`
    );
    if (!ok) return null;
    update["system.basic.xp"] = xp - xpSpent;
  }
  return {update, xpSpent, shortfall};
}

/** The ability's description for its chat card, always shown open. */
async function chatDescription(item) {
  const raw = item?.system?.description ?? "";
  if (!raw) return "";
  const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  const text = await TE.enrichHTML(raw, {relativeTo: item, secrets: false});
  if (!text) return "";
  const img = item.img ? `<img src="${item.img}" width="40" height="40" style="float:left; margin:0 6px 4px 0; border:none;"/>` : "";
  return `<div class="ad-chat-description" style="margin:4px 0;">${img}${text}<div style="clear:both;"></div></div>`;
}

function xpNote(result) {
  if (!result?.xpSpent) return "";
  const shortLabel = splitCostLabel({might: 0, speed: 0, intellect: 0, ...result.shortfall});
  return `<p><em>${game.i18n.format("AWAKENED.XPCovered", {short: shortLabel, xp: result.xpSpent})}</em></p>`;
}

async function paySplitCost(actor, item) {
  const split = getSplitCost(item);
  const net = {might: 0, speed: 0, intellect: 0};
  for (const k of SPLIT_POOLS) {
    if (split[k]) net[k] = Math.max(0, split[k] - (Number(actor.system.pools[k].edge) || 0));
  }
  const result = await resolvePayment(actor, net);
  if (!result) return;
  await actor.update(result.update);
  const paidLabel = splitCostLabel(net);
  const description = await chatDescription(item);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({actor}),
    content: `<h3 style="margin:0">${foundry.utils.escapeHTML?.(item.name) ?? item.name}</h3>${description}<p>${paidLabel ? game.i18n.format("AWAKENED.SplitPaid", {name: actor.name, cost: paidLabel}) : game.i18n.localize("AWAKENED.StackFree")}</p>${xpNote(result)}`
  });
}

/* Stacked action: several abilities used in one action. Costs are added up per pool first,
   then each pool's Edge comes off its total once (house rule). */
function isAnyPool(item) {
  return item.type === "ability" && !item.flags?.[MODULE_ID]?.splitCost
    && item.system.basic.pool === "Pool" && (parseInt(item.system.basic.cost) || 0) > 0;
}
function stackedCost(actor, ids) {
  const items = ids.map(id => actor.items.get(id)).filter(i => i && i.type === "ability");
  const chosen = getFlags(actor).stackPools ?? {};
  const total = {might: 0, speed: 0, intellect: 0};
  const skipped = [];
  for (const item of items) {
    if (isChoiceCost(item)) {
      const k = chosen[item.id];
      const split = getSplitCost(item);
      if (SPLIT_POOLS.includes(k) && split[k] > 0) total[k] += split[k];
      else skipped.push(item.name);
      continue;
    }
    if (isAnyPool(item)) {
      const k = chosen[item.id];
      if (SPLIT_POOLS.includes(k)) total[k] += parseInt(item.system.basic.cost) || 0;
      else skipped.push(item.name);
      continue;
    }
    const split = getSplitCost(item);
    const any = SPLIT_POOLS.some(k => split[k] > 0);
    const raw = parseInt(item.system.basic.cost) || 0;
    if (!any && raw > 0) skipped.push(item.name); // XP costs can't be stacked by pool
    for (const k of SPLIT_POOLS) total[k] += split[k];
  }
  const rows = SPLIT_POOLS.filter(k => total[k] > 0).map(k => {
    const pool = actor.system.pools[k];
    const edge = Number(pool.edge) || 0;
    const net = Math.max(0, total[k] - edge);
    return {key: k, label: game.i18n.localize(`CYPHERSYSTEM.${POOL_NAME[k]}`), total: total[k], edge, net, value: pool.value, short: net > pool.value, xp: Math.max(0, net - Math.max(0, pool.value))};
  });
  return {items, total, rows, skipped};
}

/** Ask which pool an "Any Pool" ability should draw from. Returns "might" | "speed" | "intellect" | null. */
async function choosePool(item, options = SPLIT_POOLS) {
  const split = isChoiceCost(item) ? getSplitCost(item) : null;
  const label = k => {
    const pool = game.i18n.localize(`CYPHERSYSTEM.${POOL_NAME[k]}`);
    return split ? `${split[k]} ${pool}` : pool;
  };
  const DialogV2 = foundry.applications?.api?.DialogV2;
  const title = game.i18n.format("AWAKENED.ChoosePoolTitle", {name: item.name});
  const content = split
    ? `<p>${game.i18n.format("AWAKENED.ChooseOneText", {name: item.name, options: choiceCostLabel(split)})}</p>`
    : `<p>${game.i18n.format("AWAKENED.ChoosePoolText", {name: item.name, cost: item.system.basic.cost})}</p>`;
  if (DialogV2) {
    const result = await DialogV2.wait({
      window: {title},
      content,
      buttons: options.map((k, i) => ({action: k, label: label(k), default: i === 0})),
      rejectClose: false
    });
    return options.includes(result) ? result : null;
  }
  return new Promise(resolve => {
    const buttons = {};
    for (const k of options) buttons[k] = {label: label(k), callback: () => resolve(k)};
    new Dialog({title, content, buttons, default: options[0], close: () => resolve(null)}).render(true);
  });
}

/** Pay a "pick one pool" ability: ask which pool, then pay that pool's cost minus its Edge. */
async function payChoiceCost(actor, item) {
  const split = getSplitCost(item);
  const options = SPLIT_POOLS.filter(k => split[k] > 0);
  const k = await choosePool(item, options);
  if (!k) return;
  const net = {might: 0, speed: 0, intellect: 0};
  net[k] = Math.max(0, split[k] - (Number(actor.system.pools[k].edge) || 0));
  const result = await resolvePayment(actor, net);
  if (!result) return;
  await actor.update(result.update);
  const description = await chatDescription(item);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({actor}),
    content: `<h3 style="margin:0">${foundry.utils.escapeHTML?.(item.name) ?? item.name}</h3>${description}<p>${splitCostLabel(net) ? game.i18n.format("AWAKENED.SplitPaid", {name: actor.name, cost: splitCostLabel(net)}) : game.i18n.localize("AWAKENED.StackFree")}</p>${xpNote(result)}`
  });
}

async function payStack(actor) {
  const ids = getFlags(actor).stack ?? [];
  const {items, rows, skipped} = stackedCost(actor, ids);
  if (!items.length) return;
  const net = {might: 0, speed: 0, intellect: 0};
  for (const r of rows) net[r.key] = r.net;
  const result = await resolvePayment(actor, net);
  if (!result) return;
  await actor.update({...result.update, [`${FLAG}.stack`]: [], [`${FLAG}.-=stackPools`]: null});
  const esc = t => foundry.utils.escapeHTML?.(t) ?? t;
  const lines = rows.map(r => `<li>${r.label}: ${r.total} − ${r.edge} ${game.i18n.localize("AWAKENED.Edge")} = <strong>${r.net}</strong></li>`).join("");
  const note = skipped.length ? `<p><em>${game.i18n.format("AWAKENED.StackSkipped", {names: skipped.map(esc).join(", ")})}</em></p>` : "";
  const descriptions = (await Promise.all(items.map(async i => {
    const d = await chatDescription(i);
    return d ? `<h4 style="margin:6px 0 0">${esc(i.name)}</h4>${d}` : "";
  }))).join("");
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({actor}),
    content: `<h3 style="margin:0">${game.i18n.localize("AWAKENED.StackTitle")}</h3><p>${items.map(i => esc(i.name)).join(" + ")}</p>${descriptions}<ul>${lines || `<li>${game.i18n.localize("AWAKENED.StackFree")}</li>`}</ul>${xpNote(result)}${note}`
  });
}

/* Ability window: replace the single cost/pool fields with one cost per pool. */
Hooks.on("renderItemSheet", (app, html) => {
  const item = app.document ?? app.item ?? app.object;
  if (item?.type !== "ability") return;
  const $html = html instanceof jQuery ? html : $(html);
  const costInput = $html.find('input[name="system.basic.cost"]');
  if (!costInput.length) return;

  // Passive checkbox
  const passiveBox = $(`
    <label class="ad-passive-toggle" title="${game.i18n.localize("AWAKENED.PassiveHint")}">
      <input type="checkbox" data-ad-passive ${isPassive(item) ? "checked" : ""} ${app.isEditable === false ? "disabled" : ""} />
      <span>${game.i18n.localize("AWAKENED.Passive")}</span>
    </label>`);
  costInput.closest(".resources").after(passiveBox);
  passiveBox.find("input").on("change", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    item.update({[`flags.${MODULE_ID}.passive`]: ev.currentTarget.checked});
  });

  // Abilities that cost XP keep the system's original fields.
  const hasFlag = !!item.flags?.[MODULE_ID]?.splitCost;
  const pool = item.system.basic.pool;
  const rawCost = parseInt(item.system.basic.cost) || 0;
  if (!hasFlag && pool === "XP" && rawCost > 0) return;

  // An old "Any Pool" ability opens as "player picks one of these pools" with the same cost in each.
  const split = getSplitCost(item);
  let chooseOn = !!item.flags?.[MODULE_ID]?.choosePool;
  if (!hasFlag && pool === "Pool" && rawCost > 0) {
    for (const k of SPLIT_POOLS) split[k] = rawCost;
    chooseOn = true;
  }
  const disabled = app.isEditable === false ? "disabled" : "";
  const field = k => `
    <label class="ad-split-pool ad-split-${k}">
      <span>${game.i18n.localize(`CYPHERSYSTEM.${POOL_NAME[k]}`)}</span>
      <input type="number" min="0" step="1" data-ad-split="${k}" value="${split[k]}" ${disabled} />
    </label>`;
  const editor = $(`
    <div class="ad-split-cost-editor">
      <div class="ad-split-title">${game.i18n.localize("AWAKENED.SplitCost")}</div>
      <div class="ad-split-row">${SPLIT_POOLS.map(field).join("")}</div>
      <label class="ad-choose-toggle">
        <input type="checkbox" data-ad-choose ${chooseOn ? "checked" : ""} ${disabled} />
        <span>${game.i18n.localize("AWAKENED.ChooseOneToggle")}</span>
      </label>
      <div class="ad-split-hint">${game.i18n.localize(chooseOn ? "AWAKENED.ChooseOneHint" : "AWAKENED.SplitCostHint")}</div>
    </div>`);
  costInput.closest(".resources").replaceWith(editor);

  editor.find("input[data-ad-split]").on("focus", ev => ev.currentTarget.select());
  const saveEditor = () => {
    const next = {};
    editor.find("input[data-ad-split]").each((_, el) => { next[el.dataset.adSplit] = Math.max(0, parseInt(el.value) || 0); });
    const choose = editor.find("input[data-ad-choose]").prop("checked");
    return setSplitCost(item, next, choose);
  };
  editor.find("input[data-ad-choose]").on("change", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    saveEditor();
  });
  editor.find("input[data-ad-split]").on("change", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    saveEditor();
  });
});

/* Recovery dice picker: count, die size and bonus, composed into the system's formula field. */
const RECOVERY_DICE_COUNTS = [1, 2, 3, 4];
const RECOVERY_DIE_SIZES = [4, 6, 8, 10, 12, 20];
function parseRecovery(formula) {
  const m = /^\s*(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(formula ?? "");
  if (!m) return null;
  return {count: Number(m[1]), size: Number(m[2]), bonus: m[3] ? Number(`${m[3]}${m[4]}`) : 0};
}
function composeRecovery({count, size, bonus}) {
  const b = Number(bonus) || 0;
  return `${count}d${size}${b > 0 ? `+${b}` : b < 0 ? `${b}` : ""}`;
}

const MAX_AWAKENINGS = 6; // the first Awakening uses the focus from the character sentence
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
const ORDINALS = ["AWAKENED.First", "AWAKENED.Second", "AWAKENED.Third", "AWAKENED.Fourth", "AWAKENED.Fifth", "AWAKENED.Sixth"];
const MORPH_SUCCESSES = 3;
const MORPH_XP = 2;
const MORPH_START_DIFFICULTY = 6;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "makeDefault", {
    name: "AWAKENED.SettingDefault",
    hint: "AWAKENED.SettingDefaultHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, "campaignTitle", {
    name: "AWAKENED.SettingTitle",
    hint: "AWAKENED.SettingTitleHint",
    scope: "world",
    config: true,
    type: String,
    default: "Awakened Dreaming",
    onChange: () => rerenderOpenSheets()
  });

  game.settings.register(MODULE_ID, "xpFallback", {
    name: "AWAKENED.SettingXPFallback",
    hint: "AWAKENED.SettingXPFallbackHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "xpPerPoint", {
    name: "AWAKENED.SettingXPRate",
    hint: "AWAKENED.SettingXPRateHint",
    scope: "world",
    config: true,
    type: Number,
    range: {min: 1, max: 5, step: 1},
    default: 1
  });

  game.settings.register(MODULE_ID, "currencyNames", {
    name: "AWAKENED.SettingCurrency",
    hint: "AWAKENED.SettingCurrencyHint",
    scope: "world",
    config: true,
    type: String,
    default: "Ket, Pilt, Peak, Throne",
    onChange: () => rerenderOpenSheets()
  });

  game.settings.register(MODULE_ID, "bulanNames", {
    name: "AWAKENED.SettingBulans",
    hint: "AWAKENED.SettingBulansHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });
});

/* Rename cyphers to Bulans across the system's labels (sheet, item types, chat). */
Hooks.once("i18nInit", () => {
  let enabled = true;
  try { enabled = game.settings.get(MODULE_ID, "bulanNames"); } catch (e) { /* settings not ready: keep default */ }
  if (!enabled) return;

  const keys = [
    "TYPES.Item.cypher", "CYPHERSYSTEM.Cypher", "CYPHERSYSTEM.Cyphers", "CYPHERSYSTEM.NewCypher",
    "CYPHERSYSTEM.UnidentifiedCypher", "CYPHERSYSTEM.NameOfUnidentifiedCypher", "CYPHERSYSTEM.SortCyphersByType",
    "CYPHERSYSTEM.NoTypeCypher", "CYPHERSYSTEM.NoTypeFantasticCypher", "CYPHERSYSTEM.SubtleCypher",
    "CYPHERSYSTEM.SubtleFantasticCypher", "CYPHERSYSTEM.ManifestCypher", "CYPHERSYSTEM.ManifestFantasticCypher"
  ];
  const t = game.i18n.translations;
  for (const key of keys) {
    const value = foundry.utils.getProperty(t, key);
    if (typeof value !== "string") continue;
    foundry.utils.setProperty(t, key, value.replace(/Cypher/g, "Bulan").replace(/cypher/g, "Bulan"));
  }
  const limit = foundry.utils.getProperty(t, "CYPHERSYSTEM.CypherLimit");
  if (typeof limit === "string") foundry.utils.setProperty(t, "CYPHERSYSTEM.CypherLimit", game.i18n.localize("AWAKENED.BulanLimit"));
});

function rerenderOpenSheets() {
  for (const app of Object.values(ui.windows ?? {})) {
    if (app.element?.hasClass?.("awakened-dreaming")) app.render(false);
  }
}

// New player characters start with the house-rule recovery formula.
Hooks.on("preCreateActor", (actor, data) => {
  if (actor.type !== "pc") return;
  if (foundry.utils.getProperty(data, "system.combat.recoveries.roll")) return;
  actor.updateSource({"system.combat.recoveries.roll": HOUSE_RECOVERY});
});

// "setup" runs after every package's "init", so the Cypher System has already
// exposed its sheet classes on game.cyphersystem by now.
Hooks.once("setup", () => {
  const BasePCSheet = game.cyphersystem?.CypherActorSheetPC;
  if (!BasePCSheet) {
    console.error(`${MODULE_ID} | Cypher System PC sheet not found; sheet not registered.`);
    Hooks.once("ready", () => ui.notifications.error(game.i18n.localize("AWAKENED.MissingSystem")));
    return;
  }

  class AwakenedDreamingPCSheet extends BasePCSheet {

    /** @override */
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        classes: ["cyphersystem", "sheet", "actor", "pc", "awakened-dreaming"],
        template: `${TEMPLATE_ROOT}/ad-pc-sheet.hbs`,
        width: 780,
        height: 960
      });
    }

    /** @override */
    async getData() {
      const data = await super.getData();
      // Passive abilities move out of the ability categories into their own folding section.
      const passives = [];
      for (const key of ["abilities", "abilitiesTwo", "abilitiesThree", "abilitiesFour"]) {
        const list = data.itemLists?.[key];
        if (!Array.isArray(list)) continue;
        data.itemLists[key] = list.filter(i => {
          const doc = this.actor.items.get(i._id ?? i.id);
          if (doc && isPassive(doc)) { passives.push(i); return false; }
          return true;
        });
      }
      data.ad = buildSheetData(this.actor, data);
      data.ad.passiveLists = {abilities: passives};
      data.ad.passiveCount = passives.length;
      data.ad.passivesOpen = !!game.user.getFlag(MODULE_ID, "passivesOpen")?.[this.actor.id];
      return data;
    }

    /**
     * House rule: the Effort limit equals Tier. Keep the system's Effort field in step with Tier
     * so the system's roll dialog offers the right number of Effort levels.
     * @override
     */
    async _updateObject(event, formData) {
      if (formData["system.basic.tier"] !== undefined && formData["system.basic.tier"] !== null) {
        formData["system.basic.effort"] = Number(formData["system.basic.tier"]) || 0;
      }
      return super._updateObject(event, formData);
    }

    /** @override */
    activateListeners(html) {
      super.activateListeners(html);
      const actor = this.actor;

      // Split-cost abilities: show "(1 Might, 1 Speed, 1 Intellect)" in the lists.
      // Single-pool abilities: pay through the same house-rule payment (XP covers a shortfall),
      // unless the table uses the All-in-One dialog or the ability runs its own macro.
      const useAiO = (() => { try { return game.settings.get("cyphersystem", "itemMacrosUseAllInOne"); } catch (e) { return false; } })();
      html.find("li.item[data-item-id]").each((_, li) => {
        const item = actor.items.get(li.dataset.itemId);
        if (!item || item.type !== "ability" || isSplitCost(item) || isChoiceCost(item) || useAiO) return;
        if (item.system.settings?.rollButton?.macroUuid) return;
        const split = getSplitCost(item);
        if (!SPLIT_POOLS.some(k => split[k] > 0)) return;
        const pay = $(li).find(".item-pay");
        pay.off("click");
        if (this.options.editable) pay.on("click", ev => { ev.preventDefault(); paySplitCost(actor, item); });
      });

      html.find("li.item[data-item-id]").each((_, li) => {
        const item = actor.items.get(li.dataset.itemId);
        if (!item || !isSplitCost(item)) return;
        const label = splitCostLabel(getSplitCost(item));
        $(li).find(".item-name .item-description").first().after(`<span class="ad-split-cost-label"> (${label})</span>`);
        // Pay each pool (minus that pool's Edge) instead of the system's single-pool payment.
        const pay = $(li).find(".item-pay");
        pay.off("click").attr("title", game.i18n.format("AWAKENED.SplitPayTitle", {cost: label}));
        if (this.options.editable) pay.on("click", ev => { ev.preventDefault(); paySplitCost(actor, item); });
      });

      // "Pick one pool" abilities: show "(2 Might or 2 Speed)" and ask which pool when paying.
      html.find("li.item[data-item-id]").each((_, li) => {
        const item = actor.items.get(li.dataset.itemId);
        if (!item || !isChoiceCost(item)) return;
        const label = choiceCostLabel(getSplitCost(item));
        $(li).find(".item-name .item-description").first().after(`<span class="ad-split-cost-label"> (${label})</span>`);
        const pay = $(li).find(".item-pay");
        pay.off("click").attr("title", game.i18n.format("AWAKENED.ChoicePayTitle", {cost: label}));
        if (this.options.editable) pay.on("click", ev => { ev.preventDefault(); payChoiceCost(actor, item); });
      });

      // Stack buttons on every ability row.
      const stack = getFlags(actor).stack ?? [];
      html.find("li.item[data-item-id]").each((_, li) => {
        const item = actor.items.get(li.dataset.itemId);
        if (!item || item.type !== "ability" || isPassive(item)) return;
        const on = stack.includes(item.id);
        const btn = $(`<a class="item-control ad-stack-toggle ${on ? "on" : ""}" title="${game.i18n.localize(on ? "AWAKENED.StackRemove" : "AWAKENED.StackAdd")}"><i class="fa-solid fa-layer-group"></i></a>`);
        $(li).find(".item-controls").first().prepend(btn);
        btn.on("click", async ev => {
          ev.preventDefault();
          if (!this.options.editable) return;
          const current = getFlags(actor).stack ?? [];
          if (current.includes(item.id)) {
            return actor.update({[`${FLAG}.stack`]: current.filter(id => id !== item.id)});
          }
          const update = {[`${FLAG}.stack`]: [...current, item.id]};
          if (isChoiceCost(item)) {
            const split = getSplitCost(item);
            const pool = await choosePool(item, SPLIT_POOLS.filter(k => split[k] > 0));
            if (!pool) return;
            update[`${FLAG}.stackPools.${item.id}`] = pool;
          } else if (isAnyPool(item)) {
            const pool = await choosePool(item);
            if (!pool) return;
            update[`${FLAG}.stackPools.${item.id}`] = pool;
          }
          actor.update(update);
        });
      });

      // Passive abilities: nothing to pay, so no pay button.
      html.find(".ad-passive-list li.item[data-item-id] .item-pay").remove();

      // Count badge on each ability category heading (active abilities only).
      html.find(".tab.abilities ol.items-list:not(.ad-passive-list)").each((_, ol) => {
        if (!/^Ability/.test(ol.id || "")) return;
        const count = $(ol).children("li.item[data-item-id]").length;
        $(ol).find("> li.item-header .item-name").first().append(` <span class="ad-count-badge">${count}</span>`);
      });

      // Remember, per user and per character, whether the passive section is open.
      html.find("details.ad-passives").on("toggle", ev => {
        const open = ev.currentTarget.open;
        const current = foundry.utils.deepClone(game.user.getFlag(MODULE_ID, "passivesOpen") ?? {});
        if (!!current[actor.id] === open) return;
        current[actor.id] = open;
        game.user.setFlag(MODULE_ID, "passivesOpen", current);
      });

      if (!this.options.editable) return;

      // Extra dice in the tray (d4, d8, d12); the system handles d6, d10, d20 and d100.
      html.find("[data-ad-die]").on("click", async ev => {
        ev.preventDefault();
        const formula = ev.currentTarget.dataset.adDie;
        // Use the system's own dice roller when available (same chat card, with its reroll button).
        if (game.cyphersystem?.diceRollMacro) return game.cyphersystem.diceRollMacro(formula, actor);
        const roll = await new Roll(formula).evaluate();
        roll.toMessage({speaker: ChatMessage.getSpeaker({actor}), flavor: game.i18n.format("AWAKENED.DieFlavor", {die: formula.replace(/^1/, "")})});
      });

      // Stacked action tray
      html.find("[data-ad-stack-pay]").on("click", ev => { ev.preventDefault(); payStack(actor); });
      html.find("[data-ad-stack-clear]").on("click", ev => { ev.preventDefault(); actor.update({[`${FLAG}.stack`]: [], [`${FLAG}.-=stackPools`]: null}); });
      html.find("[data-ad-stack-pool]").on("change", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        actor.update({[`${FLAG}.stackPools.${ev.currentTarget.dataset.adStackPool}`]: ev.currentTarget.value});
      });
      html.find("[data-ad-stack-remove]").on("click", ev => {
        ev.preventDefault();
        const id = ev.currentTarget.dataset.adStackRemove;
        actor.update({[`${FLAG}.stack`]: (getFlags(actor).stack ?? []).filter(x => x !== id)});
      });

      // Damage track: click a stage to set it.
      html.find("[data-ad-damage]").on("click", event => {
        event.preventDefault();
        const state = event.currentTarget.dataset.adDamage;
        if (state && state !== actor.system.combat.damageTrack.state) {
          actor.update({"system.combat.damageTrack.state": state});
        }
      });

      // Recovery pips: click to mark used / unused.
      html.find("[data-ad-recovery]").on("click", event => {
        event.preventDefault();
        const key = event.currentTarget.dataset.adRecovery;
        actor.update({[`system.combat.recoveries.${key}`]: !actor.system.combat.recoveries[key]});
      });

      // Recovery dice picker: rebuild the formula from count, die and bonus.
      html.find("[data-ad-recovery-dice]").on("change", event => {
        event.preventDefault();
        event.stopPropagation();
        const box = $(event.currentTarget).closest(".ad-recovery-dice");
        const formula = composeRecovery({
          count: Number(box.find("[data-ad-recovery-dice='count']").val()) || 1,
          size: Number(box.find("[data-ad-recovery-dice='size']").val()) || 4,
          bonus: Number(box.find("[data-ad-recovery-dice='bonus']").val()) || 0
        });
        actor.update({"system.combat.recoveries.roll": formula});
      });

      // Recovery roll for one kind (1 Turn, Respite, Long Rest).
      html.find("[data-ad-recovery-roll]").on("click", event => {
        event.preventDefault();
        rollRecovery(actor, event.currentTarget.dataset.adRecoveryRoll);
      });

      // Reset all house-rule recovery rolls.
      html.find("[data-ad-recovery-reset]").on("click", event => {
        event.preventDefault();
        const update = {};
        for (const kind of RECOVERY_KINDS) for (const key of kind.keys) update[`system.combat.recoveries.${key}`] = false;
        actor.update(update);
      });

      // Effort pips: click a pip to spend up to it, click the last spent pip to give it back.
      html.find("[data-ad-effort]").on("click", event => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.adEffort);
        const used = getFlags(actor).effortUsed ?? 0;
        const next = (index + 1 === used) ? index : index + 1;
        actor.update({[`${FLAG}.effortUsed`]: next});
      });

      // Awakenings: add / remove later Awakenings (the first one is always there).
      html.find("[data-ad-awakening-add]").on("click", event => {
        event.preventDefault();
        const list = getFlags(actor).awakenings ?? {};
        for (let n = 2; n <= MAX_AWAKENINGS; n++) {
          if (!list[`a${n}`]) return actor.update({[`${FLAG}.awakenings.a${n}`]: {aura: "", bleedThrough: "", focus: "", tier: 1}});
        }
      });
      html.find("[data-ad-awakening-remove]").on("click", event => {
        event.preventDefault();
        const id = event.currentTarget.dataset.adAwakeningRemove;
        actor.update({[`${FLAG}.awakenings.-=${id}`]: null});
      });

      // Morphs: add, log attempts, remove.
      html.find("[data-ad-morph-add]").on("click", event => {
        event.preventDefault();
        const firstAbility = abilityItems(actor)[0];
        const id = `m${foundry.utils.randomID(8)}`;
        actor.update({[`${FLAG}.morphs.${id}`]: {abilityId: firstAbility?.id ?? "", change: "", attempts: 0, successes: 0}});
      });
      html.find("[data-ad-morph-success], [data-ad-morph-fail]").on("click", event => {
        event.preventDefault();
        const el = event.currentTarget;
        const id = el.dataset.adMorphSuccess ?? el.dataset.adMorphFail;
        logMorphAttempt(actor, id, el.dataset.adMorphSuccess !== undefined);
      });
      html.find("[data-ad-morph-remove]").on("click", event => {
        event.preventDefault();
        actor.update({[`${FLAG}.morphs.-=${event.currentTarget.dataset.adMorphRemove}`]: null});
      });

      // Select the whole number when clicking into a big pool / badge field.
      html.find(".ad-select-on-focus").on("focus", event => event.currentTarget.select());
    }
  }

  foundry.documents.collections.Actors.registerSheet(MODULE_ID, AwakenedDreamingPCSheet, {
    types: ["pc"],
    makeDefault: game.settings.get(MODULE_ID, "makeDefault"),
    label: "AWAKENED.SheetLabel"
  });

  // Foundry fetches templates over its own socket, so browsers never serve stale copies of them.
  foundry.applications.handlebars.loadTemplates([
    `${TEMPLATE_ROOT}/ad-pc-sheet.hbs`,
    `${TEMPLATE_ROOT}/ad-header.hbs`,
    `${TEMPLATE_ROOT}/ad-awakening.hbs`
  ]);

  game.modules.get(MODULE_ID).api = {AwakenedDreamingPCSheet};
});

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

function getFlags(actor) {
  return actor.flags?.[MODULE_ID] ?? {};
}

function abilityItems(actor) {
  return Array.from(actor.items ?? []).filter(i => i.type === "ability")
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function rollRecovery(actor, kindId) {
  const kind = RECOVERY_KINDS.find(k => k.id === kindId);
  if (!kind) return;
  const label = game.i18n.localize(kind.label);
  const rec = actor.system.combat.recoveries;
  const free = kind.keys.find(key => !rec[key]);
  if (!free) {
    return ui.notifications.warn(game.i18n.format("AWAKENED.NoRecoveryLeft", {name: actor.name, kind: label}));
  }

  const formula = recoveryFormula(actor);
  const roll = await new Roll(formula).evaluate();
  let flavor = game.i18n.format("AWAKENED.RecoveryFlavor", {name: actor.name, kind: label});
  if (kind.restoresEffort) flavor += ` ${game.i18n.localize("AWAKENED.EffortRestored")}`;
  await roll.toMessage({speaker: ChatMessage.getSpeaker({actor}), flavor});

  const update = {[`system.combat.recoveries.${free}`]: true};
  if (kind.restoresEffort) update[`${FLAG}.effortUsed`] = 0;
  return actor.update(update);
}

async function logMorphAttempt(actor, id, success) {
  const morph = getFlags(actor).morphs?.[id];
  if (!morph) return;
  if ((morph.successes ?? 0) >= MORPH_SUCCESSES) return;
  const xp = Number(actor.system.basic.xp) || 0;
  if (xp < MORPH_XP) {
    return ui.notifications.warn(game.i18n.format("AWAKENED.MorphNoXP", {name: actor.name, xp: MORPH_XP}));
  }
  const attempts = (morph.attempts ?? 0) + 1;
  const successes = Math.min(MORPH_SUCCESSES, (morph.successes ?? 0) + (success ? 1 : 0));
  await actor.update({
    "system.basic.xp": xp - MORPH_XP,
    [`${FLAG}.morphs.${id}.attempts`]: attempts,
    [`${FLAG}.morphs.${id}.successes`]: successes
  });
  if (successes >= MORPH_SUCCESSES) {
    ui.notifications.info(game.i18n.format("AWAKENED.MorphComplete", {name: actor.name}));
  }
}

/* -------------------------------------------- */
/*  Data preparation                            */
/* -------------------------------------------- */

const POOLS = [
  {key: "might", label: "CYPHERSYSTEM.Might", rollClass: "might-roll", rollTitle: "CYPHERSYSTEM.MightRollButton", sub: "CYPHERSYSTEM.SubtractMight", add: "CYPHERSYSTEM.AddMight", reset: "CYPHERSYSTEM.ResetMight", multi: "multiRollMightEdge", glyph: "fa-hand-fist"},
  {key: "speed", label: "CYPHERSYSTEM.Speed", rollClass: "speed-roll", rollTitle: "CYPHERSYSTEM.SpeedRollButton", sub: "CYPHERSYSTEM.SubtractSpeed", add: "CYPHERSYSTEM.AddSpeed", reset: "CYPHERSYSTEM.ResetSpeed", multi: "multiRollSpeedEdge", glyph: "fa-feather"},
  {key: "intellect", label: "CYPHERSYSTEM.Intellect", rollClass: "intellect-roll", rollTitle: "CYPHERSYSTEM.IntellectRollButton", sub: "CYPHERSYSTEM.SubtractIntellect", add: "CYPHERSYSTEM.AddIntellect", reset: "CYPHERSYSTEM.ResetIntellect", multi: "multiRollIntellectEdge", glyph: "fa-eye"}
];

const DAMAGE_EFFECTS = {
  Hale: ["CYPHERSYSTEM.HaleEffect"],
  Hurt: ["CYPHERSYSTEM.HaleEffect"],
  Impaired: ["CYPHERSYSTEM.ImpairedEffect1", "CYPHERSYSTEM.ImpairedEffect2"],
  Debilitated: ["CYPHERSYSTEM.DebilitatedEffect1", "CYPHERSYSTEM.DebilitatedEffect2"],
  Dead: ["CYPHERSYSTEM.DeadEffect"]
};

function ratio(value, max) {
  const v = Number(value) || 0;
  const m = Number(max) || 0;
  if (m <= 0) return 0;
  return Math.max(0, Math.min(1, v / m));
}

/** Morphed cost: 1.5x the original, rounded up (1 → 2 → 3 → 5 → 8). */
function morphedCost(cost) {
  const n = parseFloat(cost);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.ceil(n * 1.5);
}

function buildSheetData(actor, data) {
  const sys = actor.system;
  const general = sys.settings.general;
  const flags = getFlags(actor);
  const loc = key => game.i18n.localize(key);

  // The Teen form of Unmasked has its own data paths; it keeps the system header.
  const useCustomHeader = !(general.gameMode === "Unmasked" && sys.basic.unmaskedForm === "Teen");

  const pools = POOLS.map(p => {
    const pool = sys.pools[p.key];
    return {
      ...p,
      label: loc(p.label),
      rollTitle: loc(p.rollTitle),
      sub: loc(p.sub),
      add: loc(p.add),
      reset: loc(p.reset),
      value: pool.value,
      max: pool.max,
      edge: pool.edge,
      pct: Math.round(ratio(pool.value, pool.max) * 100),
      multiClass: data.sheetSettings[p.multi] || "",
      low: pool.max > 0 && pool.value <= Math.ceil(pool.max / 4),
      empty: pool.value <= 0
    };
  });

  let additionalPool = null;
  if (general.additionalPool?.active) {
    const pool = sys.pools.additional;
    additionalPool = {
      key: "additional",
      label: general.additionalPool.label || loc("CYPHERSYSTEM.AdditionalPool"),
      value: pool.value,
      max: pool.max,
      edge: pool.edge,
      hasEdge: !!general.additionalPool.hasEdge,
      pct: Math.round(ratio(pool.value, pool.max) * 100)
    };
  }

  // Damage track
  const state = sys.combat.damageTrack.state;
  const choices = data.damageTrackChoices || {Hale: "CYPHERSYSTEM.Hale", Impaired: "CYPHERSYSTEM.Impaired", Debilitated: "CYPHERSYSTEM.Debilitated"};
  const keys = Object.keys(choices);
  const currentIndex = keys.indexOf(state);
  const damageStates = keys.map((key, index) => ({
    key,
    label: loc(choices[key]),
    css: key.toLowerCase(),
    active: key === state,
    passed: currentIndex >= 0 && index < currentIndex
  }));
  const damageEffect = (DAMAGE_EFFECTS[state] || []).map(loc).join(" ");

  // Recovery (house rules)
  const rec = sys.combat.recoveries;
  const recoveryKinds = RECOVERY_KINDS.map(kind => {
    const slots = kind.keys.map(key => ({key, used: !!rec[key]}));
    const label = loc(kind.label);
    return {
      id: kind.id,
      label,
      slots,
      exhausted: slots.every(s => s.used),
      rollTitle: game.i18n.format("AWAKENED.RecoveryRollKind", {kind: label, formula: recoveryFormula(actor)}),
      restoresEffort: !!kind.restoresEffort
    };
  });

  // Effort budget (house rule: limit = Tier, restored by the Long Rest)
  const tier = Math.max(0, Number(sys.basic.tier) || 0);
  const effortUsed = Math.min(tier, Math.max(0, Number(flags.effortUsed) || 0));
  const effort = {
    tier,
    used: effortUsed,
    remaining: tier - effortUsed,
    pips: Array.from({length: Math.min(tier, 12)}, (_, i) => ({index: i, spent: i < effortUsed}))
  };

  // Awakenings: the first uses the flags aura / bleedThrough and the sentence focus.
  const unawakened = !!flags.unawakened;
  const later = flags.awakenings ?? {};
  const awakeningList = [{
    id: "a1", first: true, roman: ROMAN[0], title: loc(ORDINALS[0]),
    auraName: `${FLAG}.aura`, bleedName: `${FLAG}.bleedThrough`,
    aura: flags.aura ?? "", bleedThrough: flags.bleedThrough ?? "",
    focus: sys.basic.focus ?? "", tier
  }];
  for (let n = 2; n <= MAX_AWAKENINGS; n++) {
    const a = later[`a${n}`];
    if (!a) continue;
    awakeningList.push({
      id: `a${n}`, first: false, roman: ROMAN[n - 1], title: loc(ORDINALS[n - 1]),
      auraName: `${FLAG}.awakenings.a${n}.aura`, bleedName: `${FLAG}.awakenings.a${n}.bleedThrough`,
      focusName: `${FLAG}.awakenings.a${n}.focus`, tierName: `${FLAG}.awakenings.a${n}.tier`,
      aura: a.aura ?? "", bleedThrough: a.bleedThrough ?? "", focus: a.focus ?? "", tier: a.tier ?? 1
    });
  }
  const auras = awakeningList.map(a => a.aura).filter(Boolean);
  const bleeds = awakeningList.map(a => a.bleedThrough).filter(Boolean);
  const awakening = {
    unawakened,
    list: awakeningList,
    count: awakeningList.length,
    canAdd: awakeningList.length < MAX_AWAKENINGS,
    auraSummary: auras.join(" · "),
    bleedSummary: bleeds.join(" · ")
  };

  // Morphs
  const abilities = abilityItems(actor);
  const morphs = Object.entries(flags.morphs ?? {}).map(([id, m]) => {
    const ability = abilities.find(a => a.id === m.abilityId);
    const choice = ability && isChoiceCost(ability);
    const split = (ability && isSplitCost(ability)) || choice;
    const cost = choice ? choiceCostLabel(getSplitCost(ability)) : split ? splitCostLabel(getSplitCost(ability)) : (ability?.system?.basic?.cost ?? "");
    const pool = split ? "" : (ability?.system?.basic?.pool ?? "");
    const attempts = Number(m.attempts) || 0;
    const successes = Math.min(MORPH_SUCCESSES, Number(m.successes) || 0);
    const newCost = split ? null : morphedCost(cost);
    return {
      id,
      abilityId: m.abilityId,
      abilityOptions: abilities.map(a => ({id: a.id, name: a.name, selected: a.id === m.abilityId})),
      abilityName: ability?.name ?? loc("AWAKENED.MorphNoAbility"),
      change: m.change ?? "",
      cost,
      pool,
      newCost,
      attempts,
      successes,
      pips: Array.from({length: MORPH_SUCCESSES}, (_, i) => ({hit: i < successes})),
      xpSpent: attempts * MORPH_XP,
      difficulty: Math.max(0, MORPH_START_DIFFICULTY - attempts),
      done: successes >= MORPH_SUCCESSES
    };
  });

  // Stacked action
  const stackIds = (flags.stack ?? []).filter(id => actor.items.get?.(id));
  let stack = {active: false};
  if (stackIds.length) {
    const sc = stackedCost(actor, stackIds);
    stack = {
      active: true,
      items: sc.items.map(i => {
        if (isChoiceCost(i)) {
          const split = getSplitCost(i);
          const chosen = (flags.stackPools ?? {})[i.id] ?? "";
          return {
            id: i.id, name: i.name, anyPool: true, cost: "",
            poolOptions: SPLIT_POOLS.filter(k => split[k] > 0).map(k => ({value: k, label: `${split[k]} ${loc(`CYPHERSYSTEM.${POOL_NAME[k]}`)}`, selected: k === chosen})),
            unchosen: !chosen
          };
        }
        if (isAnyPool(i)) {
          const chosen = (flags.stackPools ?? {})[i.id] ?? "";
          return {
            id: i.id, name: i.name, anyPool: true, cost: i.system.basic.cost,
            poolOptions: SPLIT_POOLS.map(k => ({value: k, label: loc(`CYPHERSYSTEM.${POOL_NAME[k]}`), selected: k === chosen})),
            unchosen: !chosen
          };
        }
        const split = getSplitCost(i);
        const label = splitCostLabel(split);
        return {id: i.id, name: i.name, cost: label || (parseInt(i.system.basic.cost) ? `${i.system.basic.cost} ${i.system.basic.pool}` : "0")};
      }),
      rows: sc.rows,
      skipped: sc.skipped.join(", "),
      payLabel: sc.rows.map(r => `${r.net} ${r.label}`).join(", ") || "0",
      short: sc.rows.some(r => r.short),
      xpNeeded: sc.rows.reduce((a, r) => a + r.xp, 0) * (Number(setting("xpPerPoint", 1)) || 1),
      xpFallback: setting("xpFallback", true)
    };
  }

  const advancement = [
    ["stats", "AWAKENED.AdvPools"],
    ["effort", "AWAKENED.AdvEffort"],
    ["edge", "AWAKENED.AdvEdge"],
    ["skill", "AWAKENED.AdvSkill"],
    ["other", "AWAKENED.AdvOther"]
  ].map(([key, label]) => ({key, label: loc(label), checked: !!sys.basic.advancement[key]}));

  const additionalSentence = general.additionalSentence?.active
    ? {label: general.additionalSentence.label || loc("CYPHERSYSTEM.AdditionalSentence"), value: sys.basic.additionalSentence}
    : null;

  // Money: up to six denominations from the world setting, lowest first. Amounts use the
  // Cypher System's own currency fields (quantity1 = lowest), so nothing is stored twice.
  const currencyNames = String(game.settings.get(MODULE_ID, "currencyNames") ?? "")
    .split(",").map(n => n.trim()).filter(Boolean).slice(0, 6);
  const cur = sys.settings.equipment?.currency ?? {};
  const currency = currencyNames.map((name, i) => ({
    name,
    tier: i,
    field: `system.settings.equipment.currency.quantity${i + 1}`,
    value: cur[`quantity${i + 1}`] ?? 0
  }));

  return {
    currency,
    useCustomHeader,
    isNPC: !!flags.npc,
    isGM: !!game.user?.isGM,
    campaignTitle: game.settings.get(MODULE_ID, "campaignTitle"),
    isStrange: general.gameMode === "Strange",
    flagPath: FLAG,
    pools,
    additionalPool,
    damage: {states: damageStates, effect: damageEffect, state},
    recovery: (() => {
      const formula = recoveryFormula(actor);
      const parsed = parseRecovery(formula) ?? {count: 1, size: 4, bonus: 0};
      const sizes = RECOVERY_DIE_SIZES.includes(parsed.size) ? RECOVERY_DIE_SIZES : [...RECOVERY_DIE_SIZES, parsed.size].sort((a, b) => a - b);
      const counts = RECOVERY_DICE_COUNTS.includes(parsed.count) ? RECOVERY_DICE_COUNTS : [...RECOVERY_DICE_COUNTS, parsed.count].sort((a, b) => a - b);
      return {
        kinds: recoveryKinds,
        formula,
        counts: counts.map(n => ({value: n, selected: n === parsed.count})),
        sizes: sizes.map(n => ({value: n, selected: n === parsed.size})),
        bonus: parsed.bonus || ""
      };
    })(),
    effort,
    awakening,
    stack,
    morphs,
    hasAbilities: abilities.length > 0,
    armor: {
      rating: sys.combat.armor.ratingTotal ?? 0,
      cost: sys.combat.armor.costTotal ?? 0,
      costLabel: game.i18n.format("AWAKENED.ArmorCost", {cost: sys.combat.armor.costTotal ?? 0})
    },
    advancement,
    additionalSentence
  };
}
