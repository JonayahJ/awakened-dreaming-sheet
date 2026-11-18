# Awakened Dreaming — Character Sheet

> **This is a homebrew sheet.** It was made for one table's home campaign, *Awakened Dreaming*, and follows that game's house rules, not the published Cypher System rules. It's shared publicly only so Foundry can install and update it. Feel free to look around or borrow ideas, but expect it to do things the official rules don't.

A custom player character sheet for the Awakened Dreaming campaign, built for the Cypher System (by mrkwnzl) on Foundry VTT v13–v14.

It builds on the Cypher System's own sheet, so rolls, the All-in-One dialog, pool buttons, recovery rolls, item lists, drag and drop, and the Settings tab all work exactly as before. Only the layout and look are different.

## Install

In Foundry's Setup screen, go to **Add-on Modules → Install Module**, paste this manifest URL and click **Install**:

```
https://github.com/JonayahJ/awakened-dreaming-sheet/releases/latest/download/module.json
```

Then open the world, go to **Game Settings → Manage Modules**, tick **Awakened Dreaming — Character Sheet**, and save. Characters open on the new sheet by default. If one doesn't, click **Sheet** at the top of its window and pick **Awakened Dreaming**.

**Updating:** Setup → Add-on Modules → **Check for Updates** → **Update**. Then relaunch the world, and everyone should press **Ctrl + Shift + R** so their browser loads the new files.

**Requires:** Foundry VTT v13 or v14 and the Cypher System (by mrkwnzl) 3.4 or later.

## Settings (Game Settings → Configure Settings → Awakened Dreaming)

- **Use the Awakened Dreaming sheet by default.** On by default; changing it needs a reload.
- **Campaign title on the sheet.** Sets the banner text.
- **Pay pool shortfalls with XP** (on by default) and **XP per missing pool point** (default 1).
- **Call cyphers Bulans.** On by default; changing it needs a reload. This renames cyphers to Bulans everywhere in the Cypher System (sheet, item types, chat), and the cypher limit becomes the Bulan limit.

## House rules built in

- **Three pages:** the buttons under the banner switch between **I Character**, **II Abilities & Skills** and **III Equipment**. Page I has the portrait, character sentence, Advancement, shields, pools, damage track, Recovery, Effort and Awakenings. Pages II and III start with a summary bar (pools with Edge, conditions, Effort, Tier and XP) and the Purse. Page II has the tabs, with Abilities first. Each person's sheet remembers the page and tab they last used.
- **Damage track as conditions:** Hale, then an Impaired column (Impaired, Hindered, Slowed), then a Debilitated column (Immobile, Debilitated, Unconscious). Click a condition to turn it on or off; several can be on at once. Turning on any Debilitated condition switches off the Impaired ones and holds them (shown with an amber outline). They come back when the last Debilitated condition is cleared. Clicking Hale clears everything. The effect of each active condition is listed under the track.
  - **Impaired:** all rolls and checks are +1 Difficulty stage. **Slowed:** movement is cut in half. **Immobile:** can't walk; Speed tasks +2 Difficulty, Might tasks +1. **Debilitated:** can't carry items or physically attack; Might tasks +2 Difficulty, Speed tasks +1. All conditions are reminders: the sheet never charges or rolls anything for them, so players can roll physical dice. Whoever rolls applies them.
  - **Hindered:** each level of Effort costs 2 extra points from the pool used, and Edge doesn't reduce them.
  - **Unconscious:** fall prone and take no actions. The **Spend 2 XP: +1 Intellect and wake up** button does exactly that; it's greyed out with less than 2 XP.
  - The Cypher System's own Impaired and Debilitated roll penalties are switched off so they don't stack with these. Its damage track still follows along (Hale, Impaired or Debilitated) for anything that reads it.

- **Recovery:** rolls are 1d4. Any character still on the Cypher System's default formula (1d6+1) uses 1d4, and new characters start at 1d4. Pick the recovery dice in the Recovery box: number of dice, die size (d4 to d20) and an optional bonus, for abilities that raise the recovery dice. There is one 1 Turn roll, two Respite rolls and one Long Rest roll. Each kind has its own heart button. The button rolls the recovery formula, posts the result to chat and marks the roll as used. The Long Rest also restores Effort. Click a diamond to mark or unmark it by hand, and use the circle arrow to reset them all.
- **Effort:** the Effort limit equals Tier. "Effort today" shows one diamond per Tier; click to spend. The Effort shield shows what's left. The system's own Effort field is kept equal to Tier automatically, so the roll dialog offers the right number of Effort levels.
- **Awakenings (page I):** up to six Awakenings, each with its own Aura, Bleed-through, Focus and Tier. The first Awakening uses the focus from the character sentence and the character's Tier. Tick Unawakened and Aura and Bleed-through read None. The header shows all auras and bleed-throughs; hover over a chip to read it in full.
- **Equipment (page III):** two tabs, **Worn** and **Inventory**. Inventory is the Cypher System's equipment and Bulan lists (the Bulan limit is set there).
  - **Worn:** a figure with a dot for every slot: Head, Chest, Hands, Legs, Feet, Shield, Weapon, Belt, Back and Jewelry. Click a slot card or its dot to choose what goes there; click an item's name to open it. The × empties a slot; the double arrow takes an item off every slot it fills.
  - **Belt** holds the belt plus anything hanging from it. **Back** and **Jewelry** hold any number of items.
  - **Which items fit where:** each item's window has a **Can be worn on** row. Equipping an item fills every ticked slot that's free (Leather Armor ticked for Chest, Legs, Hands and Feet fills all four). Putting something else in one of those slots replaces it there only. The picker also lists other items; choosing one marks it as wearable in that slot.
  - **Armor:** each worn armor item counts once, however many slots it fills. Armor that isn't in any slot stops counting (the sheet marks it as not worn). Tick **Trained in** Light, Medium or Heavy; armor of a trained class has no Speed cost. The armor class comes from the armor item's own type.
  - **Bulans:** any item can be ticked **This is a Bulan** in its window, with **Active** or **Inactive**. Cypher-type items are Bulans by default and start Inactive. Only Active Bulans count against the limit. Click the Active/Inactive tag on page III to switch. Going over the limit is allowed: the counter turns red, a banner explains, and a warning card goes to chat for everyone.
- **Effort costs no pool points:** in the Cypher System's roll window, Effort still eases the task and adds damage, and the per-roll limit (Tier) still applies, but no Might, Speed or Intellect is taken for it. Track Effort with the "Effort today" diamonds. (An ability set to roll without opening the window, with Effort pre-filled, still uses the Cypher System's cost.)
- **Morphs in Progress (bottom of the Abilities tab):** pick the ability and write the one aspect that changes. Log each attempt as a Success or a Failure; either one spends 2 XP. The tracker shows the next difficulty (6, easing by 1 per attempt), progress toward 3 successes, total XP spent, and the new cost (1.5x, rounded up).
- **Abilities that cost more than one pool:** an ability's window has three boxes, Might, Speed and Intellect. Enter the points it takes from each and leave unused pools at 0. On the character sheet the ability shows its full cost, for example "(1 Might, 1 Speed, 1 Intellect)". The pay button takes each pool's cost minus that pool's Edge and posts what was paid to chat. Abilities that cost only one pool still work exactly like the Cypher System's (All-in-One roll dialog included). Abilities set to cost XP or "Any Pool" keep the system's original fields.
- **Abilities that let the player pick a pool** (for example Heavy Draw: 2 Might or 2 Speed): fill in the cost for each allowed pool and tick **Player picks one of these pools**. The sheet shows "(2 Might or 2 Speed)", and paying or stacking asks which of those pools to use. Edge applies to the chosen pool.
- **"+" costs (1+, 2+ and so on):** tick **Player can pay more** in the ability's window. The cost boxes become minimums, and the sheet shows the cost as, for example, "(2+ Intellect)". Paying asks how many points to spend. Stacking asks too, and you can change the amount on the ability's chip in the tray before paying. Works with "pick one pool" and Any Pool abilities.
- **Stacked actions:** to use several abilities in one action (for example Heavy Draw + Sneak Attack + Multiarrow), click the stack icon on each one in the Abilities tab. A tray at the top of the tab adds up their costs per pool, takes Edge off each pool's total once, and pays everything with one button. The payment is posted to chat and the stack is cleared. Paying a single ability on its own still takes Edge off that ability's cost. When you stack an ability that costs "Any Pool", the sheet asks which pool it should draw from. You can change that pool from the dropdown on its chip in the tray. Only abilities that cost XP are left out of a stack.
- **Paying with XP when a pool runs out:** if paying for an ability or a stack would take a pool below 0, the pool drops to 0 and the missing points are paid with XP. The sheet asks first, and the chat message says how much XP was used. If there isn't enough XP, nothing is paid. Two settings control this: turning it off, and how much XP one missing point costs (default 1). This covers the pay buttons on the sheet and the stack. It doesn't cover the Cypher System's All-in-One roll dialog or Effort spent in a roll.
- **Passive abilities:** tick **Passive ability** in an ability's window. Passives move into a folding "Passive abilities" section under the active ones, with a count, and have no pay or stack buttons. Each person's sheet remembers whether that section is open. The active ability headings show a count too.
- **NPCs:** NPCs in this game work like PCs, so make them as Player Character-type actors. The GM sees an **NPC** tick box at the end of the Advancement row. Ticking it adds a red NPC seal to the portrait and an NPC tag to the banner. Players can see the marker but can't change it.
- **Purse:** pages II and III show money as Ket, Pilt, Peak and Throne (lowest to highest). Change the names in the module settings (**Currency names**, comma-separated, up to six). The amounts are stored in the Cypher System's own currency fields.
- **No GM Notes tab.** The Cypher System's GM Notes tab is removed. Anything already in it stays saved on the actor.
- Pools (Might, Speed, Intellect, Edge) are unchanged for now.

## Other details

- The dice tray on the side of the sheet has d4, d6, d8, d10, d12, d20 and d100. Rolls follow each person's roll mode (public, private, blind).
- Tier, XP and Armor sit in shields. Armor is calculated from equipped armor.
- A pool ring glows when the pool drops to a quarter or less.
- The Teen form of the Unmasked game mode falls back to the system's original header.
- Homebrew data is stored in actor flags under `awakened-dreaming-sheet`. Recovery rolls use the system's own recovery fields.

Fonts: Cinzel, Cinzel Decorative and EB Garamond, all under the SIL Open Font License. The license files are in `fonts/`.

## Publishing a new version (for the maintainer)

Raise `version` in `module.json` and push to `main`. GitHub Actions sees the new version, tags it (for example `v1.7.1`), builds `module.zip` and publishes a release with `module.json` and `module.zip` attached. Foundry's update button picks it up from there. A push that doesn't change the version doesn't publish anything.
