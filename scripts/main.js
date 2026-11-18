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
/** "+" costs (1+, 2+ ...): the cost is a minimum and the player chooses how much to pay. */
function isPlusCost(item) {
  if (item?.type !== "ability") return false;
  const f = item.flags?.[MODULE_ID]?.plus;
  if (f !== undefined) return !!f;
  return String(item.system?.basic?.cost ?? "").trim().endsWith("+");
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
function choiceCostLabel(split, plus = false) {
  const or = ` ${game.i18n.localize("AWAKENED.Or")} `;
  return SPLIT_POOLS.filter(k => split[k] > 0)
    .map(k => `${split[k]}${plus ? "+" : ""} ${game.i18n.localize(`CYPHERSYSTEM.${POOL_NAME[k]}`)}`).join(or);
}
function isSplitCost(item) {
  if (item.type !== "ability" || isChoiceCost(item)) return false;
  const s = getSplitCost(item);
  return SPLIT_POOLS.filter(k => s[k] > 0).length > 1;
}
function splitCostLabel(split, plus = false) {
  return SPLIT_POOLS.filter(k => split[k] > 0)
    .map(k => `${split[k]}${plus ? "+" : ""} ${game.i18n.localize(`CYPHERSYSTEM.${POOL_NAME[k]}`)}`).join(", ");
}
async function setSplitCost(item, split, choose, plus) {
  const used = SPLIT_POOLS.filter(k => split[k] > 0);
  const update = {[`flags.${MODULE_ID}.splitCost`]: split};
  if (choose !== undefined) update[`flags.${MODULE_ID}.choosePool`] = !!choose;
  if (plus !== undefined) update[`flags.${MODULE_ID}.plus`] = !!plus;
  const isPlus = plus !== undefined ? !!plus : isPlusCost(item);
  if (used.length === 1) {
    update["system.basic.cost"] = `${split[used[0]]}${isPlus ? "+" : ""}`;
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

/* Damage track as conditions (house rule).
   Impaired group: any mix can be on. Debilitated group: any mix can be on, and while any is on
   the Impaired ones are switched off and held; they come back when the last Debilitated one clears. */
const CONDITIONS = {
  impaired: ["impaired", "hindered", "slowed"],
  debilitated: ["immobile", "debilitated", "unconscious"]
};
const CONDITION_KEYS = [...CONDITIONS.impaired, ...CONDITIONS.debilitated];
const CONDITION_LABEL = {
  impaired: "AWAKENED.CondImpaired", hindered: "AWAKENED.CondHindered", slowed: "AWAKENED.CondSlowed",
  immobile: "AWAKENED.CondImmobile", debilitated: "AWAKENED.CondDebilitated", unconscious: "AWAKENED.CondUnconscious"
};
const CONDITION_EFFECT = Object.fromEntries(CONDITION_KEYS.map(k => [k, `${CONDITION_LABEL[k]}Effect`]));
const WAKE_XP = 2;

/** Current conditions: {on: {key: bool}, held: [keys]}. Older characters fall back to the system track. */
function readConditions(actor) {
  const f = actor.flags?.[MODULE_ID]?.conditions;
  const on = Object.fromEntries(CONDITION_KEYS.map(k => [k, false]));
  if (f && typeof f === "object") {
    for (const k of CONDITION_KEYS) on[k] = !!f[k];
    const held = Array.isArray(f.held) ? f.held.filter(k => CONDITIONS.impaired.includes(k)) : [];
    return {on, held};
  }
  const state = actor.system?.combat?.damageTrack?.state;
  if (state === "Impaired") on.impaired = true;
  if (state === "Debilitated") on.debilitated = true;
  return {on, held: []};
}

/** Pure rule: what the conditions become after clicking `key` ("hale" clears everything). */
function toggleCondition(current, key) {
  const on = {...current.on};
  let held = [...(current.held ?? [])];
  const anyDeb = () => CONDITIONS.debilitated.some(k => on[k]);
  if (key === "hale") {
    for (const k of CONDITION_KEYS) on[k] = false;
    return {on, held: []};
  }
  if (CONDITIONS.impaired.includes(key)) {
    if (anyDeb()) held = held.includes(key) ? held.filter(k => k !== key) : [...held, key];
    else on[key] = !on[key];
    return {on, held};
  }
  if (CONDITIONS.debilitated.includes(key)) {
    const wasDeb = anyDeb();
    on[key] = !on[key];
    if (!wasDeb && on[key]) {
      held = CONDITIONS.impaired.filter(k => on[k]);
      for (const k of CONDITIONS.impaired) on[k] = false;
    } else if (wasDeb && !anyDeb()) {
      for (const k of held) on[k] = true;
      held = [];
    }
    return {on, held};
  }
  return {on, held};
}

/** Actor update for a set of conditions. The system's own track follows along for anything that
    reads it, but its built-in roll penalties stay off so they don't double up with these. */
function conditionUpdate(next) {
  const anyDeb = CONDITIONS.debilitated.some(k => next.on[k]);
  const anyImp = CONDITIONS.impaired.some(k => next.on[k]);
  return {
    [`${FLAG}.conditions`]: {...next.on, held: next.held},
    "system.combat.damageTrack.state": anyDeb ? "Debilitated" : anyImp ? "Impaired" : "Hale",
    "system.combat.damageTrack.applyImpaired": false,
    "system.combat.damageTrack.applyDebilitated": false
  };
}

/* ===================== Equipment page: worn slots, armor, Bulans ===================== */

/* Slots with one item each, and slots that hold any number. "beltItems" are things hanging from
   the belt; items declare them with the "belt" slot, like the belt itself. */
const SINGLE_SLOTS = ["head", "chest", "hands", "legs", "feet", "shield", "weapon", "belt"];
const MULTI_SLOTS = ["back", "jewelry", "beltItems"];
const ITEM_SLOT_CHOICES = ["head", "chest", "legs", "hands", "feet", "shield", "weapon", "belt", "back", "jewelry"];
const SLOT_LABEL = {
  head: "AWAKENED.SlotHead", chest: "AWAKENED.SlotChest", hands: "AWAKENED.SlotHands", legs: "AWAKENED.SlotLegs",
  feet: "AWAKENED.SlotFeet", shield: "AWAKENED.SlotShield", weapon: "AWAKENED.SlotWeapon", belt: "AWAKENED.SlotBelt",
  back: "AWAKENED.SlotBack", jewelry: "AWAKENED.SlotJewelry", beltItems: "AWAKENED.SlotBeltItems"
};
const GEAR_TYPES = ["equipment", "armor", "attack", "cypher", "artifact", "oddity", "material", "ammo"];
const ARMOR_CLASS = {"light armor": "light", "medium armor": "medium", "heavy armor": "heavy"};

/* Where each slot sits on the figure (viewBox 0 0 200 400). */
const DOLL_SPOTS = [
  {slot: "head", cx: 100, cy: 40, r: 11},
  {slot: "jewelry", cx: 100, cy: 76, r: 8},
  {slot: "back", cx: 134, cy: 94, r: 9},
  {slot: "chest", cx: 100, cy: 128, r: 11},
  {slot: "belt", cx: 100, cy: 194, r: 8},
  {slot: "hands", cx: 36, cy: 204, r: 11},
  {slot: "hands", cx: 164, cy: 204, r: 11},
  {slot: "weapon", cx: 14, cy: 236, r: 9},
  {slot: "shield", cx: 186, cy: 236, r: 9},
  {slot: "legs", cx: 84, cy: 268, r: 11},
  {slot: "legs", cx: 116, cy: 268, r: 11},
  {slot: "feet", cx: 82, cy: 348, r: 11},
  {slot: "feet", cx: 118, cy: 348, r: 11}
];

function itemSlots(item) {
  const f = item?.flags?.[MODULE_ID]?.slots;
  return Array.isArray(f) ? f.filter(s => ITEM_SLOT_CHOICES.includes(s)) : [];
}
/** Cyphers-type items are Bulans unless unticked; anything else can be ticked as one. */
function isBulan(item) {
  const f = item?.flags?.[MODULE_ID]?.bulan;
  if (f !== undefined) return !!f;
  return item?.type === "cypher";
}
function isBulanActive(item) {
  return isBulan(item) && !!item?.flags?.[MODULE_ID]?.bulanActive;
}
function armorClass(item) {
  return item?.type === "armor" ? (ARMOR_CLASS[item.system?.basic?.type] ?? null) : null;
}
function armorTraining(actor) {
  const t = actor?.flags?.[MODULE_ID]?.armorTraining ?? {};
  return {light: !!t.light, medium: !!t.medium, heavy: !!t.heavy};
}
function wantedSlot(slot) {
  return slot === "beltItems" ? "belt" : slot;
}

/** The worn-slot map, with items that no longer exist dropped. */
function readEquip(actor) {
  const f = actor?.flags?.[MODULE_ID]?.equip ?? {};
  const has = id => !!id && !!actor.items?.get(id);
  const out = {};
  for (const s of SINGLE_SLOTS) out[s] = has(f[s]) ? f[s] : null;
  for (const s of MULTI_SLOTS) out[s] = Array.isArray(f[s]) ? [...new Set(f[s].filter(has))] : [];
  return out;
}
function wornSlotsOf(eq, id) {
  const out = SINGLE_SLOTS.filter(s => eq[s] === id);
  for (const s of MULTI_SLOTS) if (eq[s].includes(id)) out.push(s);
  return out;
}

/** Pure rule: put `item` in `slot`. A single slot replaces what was there. The item also fills
    every other single slot it can be worn on that is still free. */
function equipRule(eq, slot, id, slots) {
  const next = foundry.utils.deepClone(eq);
  if (MULTI_SLOTS.includes(slot)) {
    if (!next[slot].includes(id)) next[slot].push(id);
    return next;
  }
  next[slot] = id;
  for (const s of slots) if (SINGLE_SLOTS.includes(s) && !next[s]) next[s] = id;
  return next;
}
function unequipRule(eq, slot, id) {
  const next = foundry.utils.deepClone(eq);
  if (MULTI_SLOTS.includes(slot)) next[slot] = next[slot].filter(x => x !== id);
  else if (!id || next[slot] === id) next[slot] = null;
  return next;
}
function unequipEverywhere(eq, id) {
  const next = foundry.utils.deepClone(eq);
  for (const s of SINGLE_SLOTS) if (next[s] === id) next[s] = null;
  for (const s of MULTI_SLOTS) next[s] = next[s].filter(x => x !== id);
  return next;
}

/** Save the slots, and mark armor as worn only while it is in a slot, so the Cypher System's
    own armor total (rating counted once per item) stays right. */
async function saveEquip(actor, eq) {
  await actor.update({[`${FLAG}.equip`]: eq});
  const changes = [];
  for (const item of actor.items) {
    if (item.type !== "armor" || item.system.archived) continue;
    const worn = wornSlotsOf(eq, item.id).length > 0;
    if (!!item.system.active !== worn) changes.push({_id: item.id, "system.active": worn});
  }
  if (changes.length) await actor.updateEmbeddedDocuments("Item", changes);
}

function bulanCounts(actor, extraActiveId) {
  let active = 0, carried = 0;
  const activeNames = [];
  for (const item of actor.items) {
    if (item.system?.archived) continue;
    if (!isBulan(item)) continue;
    carried++;
    if (isBulanActive(item) || item.id === extraActiveId) { active++; activeNames.push(item.name); }
  }
  const limit = Number(actor.system?.equipment?.cypherLimit) || 0;
  return {active, carried, limit, over: limit > 0 && active > limit, activeNames};
}

/** Activate or deactivate a Bulan. Going over the limit is allowed, with a warning. */
async function setBulanActive(item, active) {
  const actor = item.parent;
  if (active && actor) {
    const counts = bulanCounts(actor, item.id);
    await item.update({[`flags.${MODULE_ID}.bulanActive`]: true});
    if (counts.over) warnBulanLimit(actor, item, counts);
  } else {
    await item.update({[`flags.${MODULE_ID}.bulanActive`]: !!active});
  }
}

function warnBulanLimit(actor, item, counts) {
  const esc = s => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(s) : String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]));
  ui.notifications.warn(game.i18n.format("AWAKENED.BulanOverToast", {name: actor.name, active: counts.active, limit: counts.limit}));
  const list = counts.activeNames.map(n => n === item.name ? `<li><b>${esc(n)}</b> ${game.i18n.localize("AWAKENED.BulanNew")}</li>` : `<li>${esc(n)}</li>`).join("");
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({actor}),
    content: `<div class="ad-bulan-warn" style="border:1.5px solid #9e2b23;border-radius:5px;overflow:hidden;">
      <div style="background:linear-gradient(180deg,#24204a,#17142f);color:#dcbd6e;padding:5px 9px;letter-spacing:.08em;"><i class="fas fa-triangle-exclamation" style="color:#e2645b"></i> ${game.i18n.localize("AWAKENED.BulanOverTitle")}</div>
      <div style="background:#fbf3df;padding:7px 10px;">
        <p style="margin:0 0 4px;">${game.i18n.format("AWAKENED.BulanActivated", {name: esc(actor.name), item: `<b>${esc(item.name)}</b>`})}</p>
        <p style="margin:2px 0;text-align:center;color:#9e2b23;"><b style="font-size:20px;">${counts.active}</b> / ${counts.limit} ${game.i18n.localize("AWAKENED.ActiveBulans")}</p>
        <ul style="margin:4px 0;padding-left:18px;">${list}</ul>
        <p style="margin:4px 0 0;font-style:italic;">${game.i18n.localize("AWAKENED.BulanOverChatNote")}</p>
      </div></div>`
  });
}

/** Ask which item goes into a slot. Returns {action, id} or null. */
async function pickForSlot(actor, slot) {
  const want = wantedSlot(slot);
  const eq = readEquip(actor);
  const current = MULTI_SLOTS.includes(slot) ? null : eq[slot];
  const gear = actor.items.filter(i => GEAR_TYPES.includes(i.type) && !i.system?.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!gear.length) {
    ui.notifications.info(game.i18n.localize("AWAKENED.NoGear"));
    return null;
  }
  const taken = MULTI_SLOTS.includes(slot) ? new Set(eq[slot]) : new Set();
  const fits = gear.filter(i => itemSlots(i).includes(want) && !taken.has(i.id));
  const others = gear.filter(i => !itemSlots(i).includes(want) && !taken.has(i.id));
  const esc = s => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(s) : s;
  const row = i => {
    const worn = wornSlotsOf(eq, i.id).filter(s => s !== slot).map(s => game.i18n.localize(SLOT_LABEL[s]));
    const note = [i.type === "armor" ? `${game.i18n.localize("AWAKENED.Armor")} ${i.system.basic.rating ?? 0}` : "",
      isBulan(i) ? game.i18n.localize(isBulanActive(i) ? "AWAKENED.BulanActive" : "AWAKENED.BulanInactive") : "",
      worn.length ? game.i18n.format("AWAKENED.AlsoWornOn", {slots: worn.join(", ")}) : ""].filter(Boolean).join(" · ");
    return `<label class="ad-pick-row"><input type="radio" name="adPick" value="${i.id}" ${i.id === current ? "checked" : ""}/>
      <img src="${i.img}" width="26" height="26"/><span class="ad-pick-name">${esc(i.name)}</span><em>${note}</em></label>`;
  };
  let content = `<div class="ad-picker">`;
  content += `<p class="ad-pick-cap">${game.i18n.format("AWAKENED.PickFits", {slot: game.i18n.localize(SLOT_LABEL[slot])})}</p>`;
  content += fits.length ? fits.map(row).join("") : `<p class="ad-pick-none">${game.i18n.localize("AWAKENED.PickNoneFit")}</p>`;
  if (others.length) {
    content += `<details class="ad-pick-others"><summary>${game.i18n.localize("AWAKENED.PickOthers")}</summary>${others.map(row).join("")}</details>`;
  }
  content += `</div>`;
  const buttons = [{action: "equip", label: game.i18n.localize("AWAKENED.Equip"), icon: "fas fa-check", default: true,
    callback: (event, button) => ({action: "equip", id: button.form?.elements?.adPick?.value || null})}];
  if (current) buttons.push({action: "empty", label: game.i18n.localize("AWAKENED.EmptySlot"), icon: "fas fa-eraser", callback: () => ({action: "empty"})});
  buttons.push({action: "cancel", label: game.i18n.localize("Cancel"), icon: "fas fa-xmark", callback: () => null});
  const DialogV2 = foundry.applications.api.DialogV2;
  const result = await DialogV2.wait({
    window: {title: game.i18n.format("AWAKENED.PickTitle", {slot: game.i18n.localize(SLOT_LABEL[slot])})},
    classes: ["awakened-dreaming-picker"],
    content, buttons, rejectClose: false
  });
  return result && typeof result === "object" ? result : null;
}

async function equipFromPicker(actor, slot) {
  const res = await pickForSlot(actor, slot);
  if (!res) return;
  const eq = readEquip(actor);
  if (res.action === "empty") return saveEquip(actor, unequipRule(eq, slot));
  if (res.action !== "equip" || !res.id) return;
  const item = actor.items.get(res.id);
  if (!item) return;
  const want = wantedSlot(slot);
  let slots = itemSlots(item);
  if (!slots.includes(want)) {
    slots = [...slots, want];
    await item.update({[`flags.${MODULE_ID}.slots`]: slots});
  }
  await saveEquip(actor, equipRule(eq, slot, item.id, slots));
}

/* House rule: armor's Speed cost only counts for classes the character isn't trained in. */
function adjustArmorCost(actor) {
  if (actor?.type !== "pc") return;
  const training = armorTraining(actor);
  if (!training.light && !training.medium && !training.heavy) return;
  let cost = 0;
  for (const piece of actor.items) {
    if (piece.type !== "armor" || piece.system.active !== true || piece.system.archived !== false) continue;
    if (piece.system.settings?.general?.unmaskedForm === "Teen") continue;
    const cls = armorClass(piece);
    if (cls && training[cls]) continue;
    cost += Number(parseInt(piece.system.basic.cost ?? 0, 10)) || 0;
  }
  actor.system.combat.armor.costTotal = cost;
}

/** Sheet data for page III. */
function buildGearData(actor) {
  const loc = key => game.i18n.localize(key);
  const eq = readEquip(actor);
  const training = armorTraining(actor);
  const view = item => {
    if (!item) return null;
    const cls = armorClass(item);
    const rating = item.type === "armor" ? Number(item.system.basic.rating) || 0 : null;
    const cost = item.type === "armor" ? Number(parseInt(item.system.basic.cost ?? 0, 10)) || 0 : 0;
    const untrainedCost = cost > 0 && !(cls && training[cls]);
    const meta = [];
    if (item.type === "armor") {
      meta.push(rating ? "" : loc("AWAKENED.NoArmor"));
      if (cls) meta.push(loc(`AWAKENED.Class${cls[0].toUpperCase()}${cls.slice(1)}`));
    }
    if (item.type === "attack") {
      const dmg = item.system.basic.damage;
      if (dmg) meta.push(game.i18n.format("AWAKENED.Damage", {dmg}));
    }
    if (item.type === "equipment" && Number(item.system.basic.quantity) > 1) meta.push(`× ${item.system.basic.quantity}`);
    const bulan = isBulan(item);
    if (bulan) meta.push(loc("AWAKENED.Bulan"));
    return {
      id: item.id, name: item.name, img: item.img, rating, isArmor: item.type === "armor",
      ratingShown: item.type === "armor" && rating > 0,
      speedCost: untrainedCost ? cost : 0,
      meta: meta.filter(Boolean).join(" · "),
      bulan, bulanActive: isBulanActive(item)
    };
  };
  const slotCss = v => !v ? "empty" : v.bulan ? (v.bulanActive ? "bulan" : "bulan-off") : v.ratingShown ? "armor" : "gear";
  const single = s => {
    const v = view(actor.items.get(eq[s]));
    const shared = v ? SINGLE_SLOTS.filter(o => o !== s && eq[o] === v.id).length > 0 : false;
    return {key: s, label: loc(SLOT_LABEL[s]), item: v, css: slotCss(v), shared};
  };
  const multi = s => ({key: s, label: loc(SLOT_LABEL[s]), items: eq[s].map(id => view(actor.items.get(id)))});

  const slots = Object.fromEntries(SINGLE_SLOTS.map(s => [s, single(s)]));
  const lists = Object.fromEntries(MULTI_SLOTS.map(s => [s, multi(s)]));

  const spots = DOLL_SPOTS.map(p => {
    let css = "empty";
    if (MULTI_SLOTS.includes(p.slot)) {
      const items = lists[p.slot].items;
      if (items.some(i => i.bulanActive)) css = "bulan";
      else if (items.some(i => i.bulan)) css = "bulan-off";
      else if (items.length) css = "gear";
    } else if (p.slot === "belt") {
      const own = slots.belt.css;
      const hanging = lists.beltItems.items;
      css = own !== "empty" ? own : hanging.length ? "gear" : "empty";
      if (hanging.some(i => i.bulanActive)) css = "bulan";
    } else css = slots[p.slot].css;
    return {...p, css, label: loc(SLOT_LABEL[p.slot])};
  });

  // Armor: each worn armor item counts once, however many slots it fills.
  const wornArmor = [];
  let speedCost = 0;
  const seen = new Set();
  for (const id of [...SINGLE_SLOTS.map(s => eq[s]), ...MULTI_SLOTS.flatMap(s => eq[s])]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const item = actor.items.get(id);
    if (item?.type !== "armor") continue;
    const v = view(item);
    speedCost += v.speedCost;
    wornArmor.push({name: v.name, rating: v.rating, speedCost: v.speedCost,
      slots: wornSlotsOf(eq, id).map(s => loc(SLOT_LABEL[s])).join(", "),
      multi: wornSlotsOf(eq, id).length > 1});
  }
  const counts = bulanCounts(actor);
  counts.overText = counts.over ? game.i18n.format("AWAKENED.BulanOverText", {name: actor.name, active: counts.active, limit: counts.limit}) : "";
  return {
    slots, lists, spots,
    armor: {total: actor.system.combat.armor.ratingTotal ?? 0, lines: wornArmor, speedCost, training,
      trainingPath: `${FLAG}.armorTraining`},
    bulans: counts
  };
}

/* The Cypher System's roll window: Effort costs no pool points (house rule). Effort still eases
   the task and adds damage, and the per-roll limit (Tier) still applies. */
function patchRollDialog(app, html) {
  const proto = Object.getPrototypeOf(app);
  if (!proto._adEffortFree && typeof proto.getData === "function") {
    proto._adEffortFree = true;
    setTimeout(() => app.rendered && app.render(false), 0);
    const origGetData = proto.getData;
    proto.getData = function (...args) {
      const d = this.object;
      if (!d) return origGetData.apply(this, args);
      const userFree = Number(d.freeEffort) || 0;
      const used = (Number(d.effortToEase) || 0) + (Number(d.effortOtherUses) || 0) + (Number(d.effortDamage) || 0);
      d.freeEffort = Math.max(used, userFree);
      let out;
      try { out = origGetData.apply(this, args); } finally { d.freeEffort = userFree; }
      try {
        const actor = fromUuidSync(d.actorUuid);
        const effort = Number(actor?.system?.basic?.effort) || 0;
        out.freeEffort = userFree;
        out.effortValue = Math.min(effort + userFree, 6);
        const tooMuch = used > 6 || (used - userFree) > effort;
        out.summaryTooMuchEffort = tooMuch ? game.i18n.localize("CYPHERSYSTEM.SpendTooMuchEffort") : "";
        out.exceedEffort = tooMuch ? "exceeded" : "";
        let rb = false;
        try { rb = game.settings.get("cyphersystem", "ruleBreakingRolls"); } catch (e) { /* ignore */ }
        out.disabledButton = (out.summaryTooMuchEffort || out.summaryNotEnoughPointsString) && !rb ? "disabled" : "";
      } catch (err) {
        console.error(`${MODULE_ID} | roll window Effort patch`, err);
      }
      return out;
    };
  }
  // Right before Roll or Pay, make every level of Effort free so no pool points are taken for it.
  const root = html?.[0] ?? html;
  if (root?.addEventListener && !root._adEffortHook) {
    root._adEffortHook = true;
    root.addEventListener("click", ev => {
      if (!ev.target?.closest?.(".roll-engine-roll, .roll-engine-pay")) return;
      const d = app.object;
      if (!d) return;
      const used = (Number(d.effortToEase) || 0) + (Number(d.effortOtherUses) || 0) + (Number(d.effortDamage) || 0);
      d.freeEffort = Math.max(used, Number(d.freeEffort) || 0);
    }, true);
  }
}
Hooks.on("renderRollEngineDialogSheet", (app, html) => {
  try { patchRollDialog(app, html); } catch (err) { console.error(`${MODULE_ID} | roll window`, err); }
});

/* Item windows: where it can be worn, and whether it's a Bulan (Active or Inactive). */
Hooks.on("renderItemSheet", (app, html) => {
  const item = app.document ?? app.item ?? app.object;
  if (!item || !GEAR_TYPES.includes(item.type)) return;
  const $html = html instanceof jQuery ? html : $(html);
  if ($html.find(".ad-gear-editor").length) return;
  const anchor = $html.find("header.sheet-header .header-fields").first();
  const target = anchor.length ? anchor : $html.find(".sheet-header").first();
  if (!target.length) return;
  const disabled = app.isEditable === false ? "disabled" : "";
  const slots = itemSlots(item);
  const bul = isBulan(item);
  const act = isBulanActive(item);
  const chips = ITEM_SLOT_CHOICES.map(s => `<label class="ad-gchip ${slots.includes(s) ? "on" : ""}">
      <input type="checkbox" data-ad-item-slot="${s}" ${slots.includes(s) ? "checked" : ""} ${disabled}/>${game.i18n.localize(SLOT_LABEL[s])}</label>`).join("");
  const box = $(`
    <div class="ad-gear-editor">
      <div class="ad-gear-cap">${game.i18n.localize("AWAKENED.WornOn")}</div>
      <div class="ad-gchips">${chips}</div>
      <p class="ad-gear-hint">${game.i18n.localize("AWAKENED.WornOnHint")}</p>
      <div class="ad-gear-bulan ${bul ? "on" : ""}">
        <label class="ad-gear-bulan-tick"><input type="checkbox" data-ad-item-bulan ${bul ? "checked" : ""} ${disabled}/> <i class="fas fa-gem"></i> ${game.i18n.localize("AWAKENED.IsBulan")}</label>
        <span class="ad-gchips ad-bulan-state">
          <label class="ad-gchip bul ${act ? "on" : ""}"><input type="radio" name="adBulanState-${item.id}" value="active" data-ad-item-bulan-state ${act ? "checked" : ""} ${bul ? "" : "disabled"} ${disabled}/>${game.i18n.localize("AWAKENED.BulanActive")}</label>
          <label class="ad-gchip bul ${bul && !act ? "on" : ""}"><input type="radio" name="adBulanState-${item.id}" value="inactive" data-ad-item-bulan-state ${bul && !act ? "checked" : ""} ${bul ? "" : "disabled"} ${disabled}/>${game.i18n.localize("AWAKENED.BulanInactive")}</label>
        </span>
        <p class="ad-gear-hint">${game.i18n.localize("AWAKENED.BulanHint")}</p>
      </div>
    </div>`);
  target.append(box);
  box.find("input").on("click change", ev => ev.stopPropagation());
  box.find("[data-ad-item-slot]").on("change", ev => {
    const chosen = box.find("[data-ad-item-slot]:checked").map((_, el) => el.dataset.adItemSlot).get();
    item.update({[`flags.${MODULE_ID}.slots`]: chosen});
  });
  box.find("[data-ad-item-bulan]").on("change", ev => {
    const on = ev.currentTarget.checked;
    item.update({[`flags.${MODULE_ID}.bulan`]: on, [`flags.${MODULE_ID}.bulanActive`]: false});
  });
  box.find("[data-ad-item-bulan-state]").on("change", ev => {
    setBulanActive(item, ev.currentTarget.value === "active");
  });
});

/* Cypher System character settings that contradict the house rules. Their rows are removed from
   the Settings tab, and characters that already changed them are put back. */
const LOCKED_SETTINGS = {
  "system.settings.general.gameMode": "Cypher",
  "system.basic.unmaskedForm": "Mask",
  "system.settings.general.additionalPool.active": false,
  "system.settings.combat.stress.active": false,
  "system.settings.combat.additionalStepDamageTrack.active": false,
  "system.settings.combat.numberOneActionRecoveries": 1,
  "system.settings.combat.numberTenMinuteRecoveries": 2,
  "system.settings.combat.armor.active": true,
  "system.settings.equipment.cyphers.active": true,
  "system.settings.equipment.currency.active": false
};
const HIDDEN_SETTING_FIELDS = [
  "system.settings.general.gameMode",
  "system.settings.general.additionalPool.active",
  "system.settings.general.additionalPool.hasEdge",
  "system.settings.combat.stress.active",
  "system.settings.combat.stress.supernaturalStressActive",
  "system.settings.combat.additionalStepDamageTrack.active",
  "system.settings.combat.numberOneActionRecoveries",
  "system.settings.combat.numberTenMinuteRecoveries",
  "system.settings.combat.armor.active",
  "system.settings.equipment.cyphers.active",
  "system.settings.equipment.currency.active",
  "system.settings.equipment.currency.hideLabels",
  "system.settings.equipment.currency.labelCategory1"
];
function lockedSettingsDiff(actor) {
  const diff = {};
  for (const [path, value] of Object.entries(LOCKED_SETTINGS)) {
    const current = foundry.utils.getProperty(actor, path);
    if (current !== undefined && current !== value) diff[path] = value;
  }
  return diff;
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
  let split = getSplitCost(item);
  if (isPlusCost(item)) {
    split = await askAmounts(item, split);
    if (!split) return;
  }
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
  const amounts = getFlags(actor).stackAmounts ?? {};
  const total = {might: 0, speed: 0, intellect: 0};
  const skipped = [];
  for (const item of items) {
    if (isChoiceCost(item)) {
      const k = chosen[item.id];
      const split = getSplitCost(item);
      if (SPLIT_POOLS.includes(k) && split[k] > 0) total[k] += Math.max(split[k], Number(amounts[item.id]?.[k]) || 0);
      else skipped.push(item.name);
      continue;
    }
    if (isAnyPool(item)) {
      const k = chosen[item.id];
      const minimum = parseInt(item.system.basic.cost) || 0;
      if (SPLIT_POOLS.includes(k)) total[k] += Math.max(minimum, Number(amounts[item.id]?.[k]) || 0);
      else skipped.push(item.name);
      continue;
    }
    const split = getSplitCost(item);
    const any = SPLIT_POOLS.some(k => split[k] > 0);
    const raw = parseInt(item.system.basic.cost) || 0;
    if (!any && raw > 0) skipped.push(item.name); // XP costs can't be stacked by pool
    for (const k of SPLIT_POOLS) total[k] += split[k] > 0 ? Math.max(split[k], Number(amounts[item.id]?.[k]) || 0) : 0;
  }
  const rows = SPLIT_POOLS.filter(k => total[k] > 0).map(k => {
    const pool = actor.system.pools[k];
    const edge = Number(pool.edge) || 0;
    const net = Math.max(0, total[k] - edge);
    return {key: k, label: game.i18n.localize(`CYPHERSYSTEM.${POOL_NAME[k]}`), total: total[k], edge, net, value: pool.value, short: net > pool.value, xp: Math.max(0, net - Math.max(0, pool.value))};
  });
  return {items, total, rows, skipped};
}

/**
 * "+" costs: ask how many points to spend from each pool. `base` holds the minimum per pool;
 * only pools with a minimum above 0 are asked about. Returns {might, speed, intellect} or null.
 */
async function askAmounts(item, base) {
  const pools = SPLIT_POOLS.filter(k => base[k] > 0);
  const title = game.i18n.format("AWAKENED.PlusTitle", {name: item.name});
  const rows = pools.map(k => `
    <div class="form-group">
      <label>${game.i18n.localize(`CYPHERSYSTEM.${POOL_NAME[k]}`)} <small>(${game.i18n.format("AWAKENED.PlusMin", {n: base[k]})})</small></label>
      <input type="number" name="${k}" min="${base[k]}" step="1" value="${base[k]}" autofocus />
    </div>`).join("");
  const content = `<p>${game.i18n.format("AWAKENED.PlusText", {name: item.name})}</p>${rows}`;
  const read = form => {
    const out = {might: 0, speed: 0, intellect: 0};
    for (const k of pools) out[k] = Math.max(base[k], parseInt(form.elements[k]?.value) || base[k]);
    return out;
  };
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2) {
    return DialogV2.wait({
      window: {title},
      content,
      buttons: [
        {action: "ok", label: game.i18n.localize("AWAKENED.PlusOK"), default: true, callback: (event, button) => read(button.form)},
        {action: "cancel", label: game.i18n.localize("AWAKENED.Cancel"), callback: () => null}
      ],
      rejectClose: false
    }).then(r => (r && typeof r === "object") ? r : null);
  }
  return new Promise(resolve => {
    new Dialog({
      title, content,
      buttons: {
        ok: {label: game.i18n.localize("AWAKENED.PlusOK"), callback: html => resolve(read(html[0].querySelector("form") ?? {elements: Object.fromEntries(pools.map(k => [k, html[0].querySelector(`[name=${k}]`)]))}))},
        cancel: {label: game.i18n.localize("AWAKENED.Cancel"), callback: () => resolve(null)}
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

/** Ask which pool an "Any Pool" ability should draw from. Returns "might" | "speed" | "intellect" | null. */
async function choosePool(item, options = SPLIT_POOLS) {
  const split = isChoiceCost(item) ? getSplitCost(item) : null;
  const label = k => {
    const pool = game.i18n.localize(`CYPHERSYSTEM.${POOL_NAME[k]}`);
    return split ? `${split[k]}${isPlusCost(item) ? "+" : ""} ${pool}` : pool;
  };
  const DialogV2 = foundry.applications?.api?.DialogV2;
  const title = game.i18n.format("AWAKENED.ChoosePoolTitle", {name: item.name});
  const content = split
    ? `<p>${game.i18n.format("AWAKENED.ChooseOneText", {name: item.name, options: choiceCostLabel(split, isPlusCost(item))})}</p>`
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
  let amount = split[k];
  if (isPlusCost(item)) {
    const picked = await askAmounts(item, {might: 0, speed: 0, intellect: 0, [k]: split[k]});
    if (!picked) return;
    amount = picked[k];
  }
  const net = {might: 0, speed: 0, intellect: 0};
  net[k] = Math.max(0, amount - (Number(actor.system.pools[k].edge) || 0));
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
  await actor.update({...result.update, [`${FLAG}.stack`]: [], [`${FLAG}.-=stackPools`]: null, [`${FLAG}.-=stackAmounts`]: null});
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
      <label class="ad-choose-toggle">
        <input type="checkbox" data-ad-plus ${isPlusCost(item) ? "checked" : ""} ${disabled} />
        <span>${game.i18n.localize("AWAKENED.PlusToggle")}</span>
      </label>
      <div class="ad-split-hint">${game.i18n.localize(chooseOn ? "AWAKENED.ChooseOneHint" : "AWAKENED.SplitCostHint")}</div>
    </div>`);
  costInput.closest(".resources").replaceWith(editor);

  editor.find("input[data-ad-split]").on("focus", ev => ev.currentTarget.select());
  const saveEditor = () => {
    const next = {};
    editor.find("input[data-ad-split]").each((_, el) => { next[el.dataset.adSplit] = Math.max(0, parseInt(el.value) || 0); });
    const choose = editor.find("input[data-ad-choose]").prop("checked");
    const plus = editor.find("input[data-ad-plus]").prop("checked");
    return setSplitCost(item, next, choose, plus);
  };
  editor.find("input[data-ad-plus]").on("change", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    saveEditor();
  });
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
        tabs: [{navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "abilities"}],
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
      const view = game.user.getFlag(MODULE_ID, "view")?.[this.actor.id] ?? {};
      if (!this._adPage) this._adPage = [1, 2, 3].includes(view.page) ? view.page : 1;
      if (!this._adGearTab) this._adGearTab = view.gearTab === "inventory" ? "inventory" : "worn";
      data.ad.gearTab = this._adGearTab;
      data.ad.gear = buildGearData(this.actor);
      data.ad.page = this._adPage;
      // Open on the tab this person last used on this sheet (once per opening).
      if (!this._adTabRestored && this._tabs?.[0]) {
        this._adTabRestored = true;
        const tabs = ["abilities", "skills", "combat", "notes", "description", "tags", "settings"];
        if (tabs.includes(view.tab)) this._tabs[0].active = view.tab;
      }
      return data;
    }

    /** Remember this person's page and tab for this sheet. */
    _adSaveView(patch) {
      const all = foundry.utils.deepClone(game.user.getFlag(MODULE_ID, "view") ?? {});
      all[this.actor.id] = {...(all[this.actor.id] ?? {}), ...patch};
      game.user.setFlag(MODULE_ID, "view", all);
    }

    /** @override */
    _onChangeTab(event, tabs, active) {
      super._onChangeTab?.(event, tabs, active);
      if (event) this._adSaveView({tab: active});
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
        if (!item || item.type !== "ability" || isSplitCost(item) || isChoiceCost(item) || (useAiO && !isPlusCost(item))) return;
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
        const label = splitCostLabel(getSplitCost(item), isPlusCost(item));
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
        const label = choiceCostLabel(getSplitCost(item), isPlusCost(item));
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
          const zero = {might: 0, speed: 0, intellect: 0};
          let base = getSplitCost(item);
          if (isChoiceCost(item)) {
            const pool = await choosePool(item, SPLIT_POOLS.filter(k => base[k] > 0));
            if (!pool) return;
            update[`${FLAG}.stackPools.${item.id}`] = pool;
            base = {...zero, [pool]: base[pool]};
          } else if (isAnyPool(item)) {
            const pool = await choosePool(item);
            if (!pool) return;
            update[`${FLAG}.stackPools.${item.id}`] = pool;
            base = {...zero, [pool]: parseInt(item.system.basic.cost) || 0};
          }
          if (isPlusCost(item) && SPLIT_POOLS.some(k => base[k] > 0)) {
            const picked = await askAmounts(item, base);
            if (!picked) return;
            update[`${FLAG}.stackAmounts.${item.id}`] = picked;
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
      html.find("[data-ad-stack-clear]").on("click", ev => { ev.preventDefault(); actor.update({[`${FLAG}.stack`]: [], [`${FLAG}.-=stackPools`]: null, [`${FLAG}.-=stackAmounts`]: null}); });
      html.find("[data-ad-stack-amount]").on("change", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const el = ev.currentTarget;
        const min = Number(el.min) || 0;
        const value = Math.max(min, parseInt(el.value) || min);
        actor.update({[`${FLAG}.stackAmounts.${el.dataset.adStackAmount}.${el.dataset.pool}`]: value});
      });
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

      // Two pages: switch without re-rendering, and remember the choice.
      html.find("[data-ad-page]").on("click", event => {
        event.preventDefault();
        const page = Math.min(3, Math.max(1, Number(event.currentTarget.dataset.adPage) || 1));
        this._adPage = page;
        const el = $(this.form ?? html[0]);
        el.removeClass("ad-on-page-1 ad-on-page-2 ad-on-page-3").addClass(`ad-on-page-${page}`);
        html.find("[data-ad-page]").removeClass("active");
        html.find(`[data-ad-page="${page}"]`).addClass("active");
        this._adSaveView({page});
      });

      // Settings that contradict the house rules are taken off the Settings tab.
      for (const name of HIDDEN_SETTING_FIELDS) {
        html.find(`.tab.settings [name="${name}"]`).closest("li.item-settings").remove();
      }
      if (actor.isOwner && !this._adLockChecked) {
        this._adLockChecked = true;
        const diff = lockedSettingsDiff(actor);
        if (Object.keys(diff).length) actor.update(diff);
      }

      // Page III: Worn / Inventory
      html.find("[data-ad-gear-tab]").on("click", event => {
        event.preventDefault();
        const tab = event.currentTarget.dataset.adGearTab === "inventory" ? "inventory" : "worn";
        this._adGearTab = tab;
        const el = $(this.form ?? html[0]);
        el.find(".ad-page3").removeClass("ad-gear-worn ad-gear-inventory").addClass(`ad-gear-${tab}`);
        el.find("[data-ad-gear-tab]").removeClass("active");
        el.find(`[data-ad-gear-tab="${tab}"]`).addClass("active");
        this._adSaveView({gearTab: tab});
      });

      // Worn slots: click a slot (or its dot on the figure) to choose what goes there.
      html.find("[data-ad-slot]").on("click", event => {
        event.preventDefault();
        if (!this.isEditable) return;
        equipFromPicker(actor, event.currentTarget.dataset.adSlot);
      });
      html.find("[data-ad-unslot]").on("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.isEditable) return;
        const {adUnslot, itemId} = event.currentTarget.dataset;
        saveEquip(actor, unequipRule(readEquip(actor), adUnslot, itemId));
      });
      html.find("[data-ad-unslot-all]").on("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.isEditable) return;
        saveEquip(actor, unequipEverywhere(readEquip(actor), event.currentTarget.dataset.adUnslotAll));
      });
      html.find("[data-ad-open-item]").on("click", event => {
        event.preventDefault();
        event.stopPropagation();
        actor.items.get(event.currentTarget.dataset.adOpenItem)?.sheet?.render(true);
      });
      html.find("[data-ad-bulan-toggle]").on("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.isEditable) return;
        const item = actor.items.get(event.currentTarget.dataset.adBulanToggle);
        if (item) setBulanActive(item, !isBulanActive(item));
      });

      // Conditions (damage track).
      html.find("[data-ad-condition]").on("click", event => {
        event.preventDefault();
        const next = toggleCondition(readConditions(actor), event.currentTarget.dataset.adCondition);
        actor.update(conditionUpdate(next));
      });

      // Unconscious: spend XP to gain 1 Intellect and wake up.
      html.find("[data-ad-wake]").on("click", async event => {
        event.preventDefault();
        const xp = Number(actor.system.basic.xp) || 0;
        if (xp < WAKE_XP) return ui.notifications.warn(game.i18n.localize("AWAKENED.WakeNoXP"));
        const current = readConditions(actor);
        if (!current.on.unconscious) return;
        const next = toggleCondition(current, "unconscious");
        await actor.update({
          ...conditionUpdate(next),
          "system.basic.xp": xp - WAKE_XP,
          "system.pools.intellect.value": (Number(actor.system.pools.intellect.value) || 0) + 1
        });
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({actor}),
          content: `<p>${game.i18n.format("AWAKENED.WakeChat", {name: actor.name, xp: WAKE_XP})}</p>`
        });
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
  // Armor training: untrained classes keep their Speed cost, trained ones lose it.
  const ActorDoc = CONFIG.Actor.documentClass;
  if (ActorDoc && !ActorDoc.prototype._adArmorPatched) {
    ActorDoc.prototype._adArmorPatched = true;
    const origDerived = ActorDoc.prototype.prepareDerivedData;
    ActorDoc.prototype.prepareDerivedData = function (...args) {
      const out = origDerived.apply(this, args);
      try { adjustArmorCost(this); } catch (err) { console.error(`${MODULE_ID} | armor cost`, err); }
      return out;
    };
  }

  foundry.applications.handlebars.loadTemplates([
    `${TEMPLATE_ROOT}/ad-pc-sheet.hbs`,
    `${TEMPLATE_ROOT}/ad-header.hbs`,
    `${TEMPLATE_ROOT}/ad-awakenings.hbs`,
    `${TEMPLATE_ROOT}/ad-morphs.hbs`,
    `${TEMPLATE_ROOT}/ad-equipment.hbs`
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

/** Tray chip for one stacked ability (pool choice dropdown for "pick a pool" and Any Pool). */
function stackChip(i, flags) {
  const loc = key => game.i18n.localize(key);
  const plus = isPlusCost(i);
  if (isChoiceCost(i)) {
    const split = getSplitCost(i);
    const chosen = (flags.stackPools ?? {})[i.id] ?? "";
    return {
      id: i.id, name: i.name, anyPool: true, cost: "",
      poolOptions: SPLIT_POOLS.filter(k => split[k] > 0).map(k => ({value: k, label: `${split[k]}${plus ? "+" : ""} ${loc(`CYPHERSYSTEM.${POOL_NAME[k]}`)}`, selected: k === chosen})),
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
  const label = splitCostLabel(split, plus);
  return {id: i.id, name: i.name, cost: label || (parseInt(i.system.basic.cost) ? `${i.system.basic.cost} ${i.system.basic.pool}` : "0")};
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

  // Conditions (house rule damage track)
  const cond = readConditions(actor);
  const condRow = k => ({key: k, label: loc(CONDITION_LABEL[k]), effect: loc(CONDITION_EFFECT[k]), on: cond.on[k], held: cond.held.includes(k)});
  const condActive = CONDITION_KEYS.filter(k => cond.on[k]).map(condRow);
  const anyImpaired = CONDITIONS.impaired.some(k => cond.on[k]);
  const anyDebilitated = CONDITIONS.debilitated.some(k => cond.on[k]);
  const conditions = {
    impaired: CONDITIONS.impaired.map(condRow),
    debilitated: CONDITIONS.debilitated.map(condRow),
    active: condActive,
    anyImpaired, anyDebilitated,
    hale: !condActive.length,
    level: anyDebilitated ? "debilitated" : anyImpaired ? "impaired" : "hale",
    summary: condActive.length ? condActive.map(c => c.label).join(", ") : loc("CYPHERSYSTEM.Hale"),
    canWake: (Number(sys.basic.xp) || 0) >= WAKE_XP
  };

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
    const cost = choice ? choiceCostLabel(getSplitCost(ability), isPlusCost(ability)) : split ? splitCostLabel(getSplitCost(ability), isPlusCost(ability)) : (ability?.system?.basic?.cost ?? "");
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
        const chip = stackChip(i, flags);
        // "+" costs: an amount box per pool, starting at what was chosen (never below the minimum).
        if (isPlusCost(i)) {
          const split = getSplitCost(i);
          const chosen = (flags.stackPools ?? {})[i.id];
          const picked = (flags.stackAmounts ?? {})[i.id] ?? {};
          let pools = SPLIT_POOLS.filter(k => split[k] > 0);
          let base = split;
          if (isChoiceCost(i)) pools = chosen ? [chosen] : [];
          else if (isAnyPool(i)) { pools = chosen ? [chosen] : []; base = {[chosen]: parseInt(i.system.basic.cost) || 0}; }
          chip.amounts = pools.map(k => ({
            pool: k,
            label: loc(`CYPHERSYSTEM.${POOL_NAME[k]}`),
            min: base[k],
            value: Math.max(base[k], Number(picked[k]) || 0)
          }));
          chip.plus = true;
        }
        return chip;
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
    conditions,
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
