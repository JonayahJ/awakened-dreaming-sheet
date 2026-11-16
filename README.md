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

- **Recovery:** rolls are 1d4. Any character still on the Cypher System's default formula (1d6+1) uses 1d4, and new characters start at 1d4. Pick the recovery dice in the Recovery box: number of dice, die size (d4 to d20) and an optional bonus, for abilities that raise the recovery dice. There is one 1 Turn roll, two Respite rolls and one Long Rest roll. Each kind has its own heart button. The button rolls the recovery formula, posts the result to chat and marks the roll as used. The Long Rest also restores Effort. Click a diamond to mark or unmark it by hand, and use the circle arrow to reset them all.
- **Effort:** the Effort limit equals Tier. "Effort today" shows one diamond per Tier; click to spend. The Effort shield shows what's left. The system's own Effort field is kept equal to Tier automatically, so the roll dialog offers the right number of Effort levels.
- **Awakening tab:** up to six Awakenings, each with its own Aura, Bleed-through, Focus and Tier. The first Awakening uses the focus from the character sentence and the character's Tier. Tick Unawakened and Aura and Bleed-through read None. The header shows all auras and bleed-throughs; hover over a chip to read it in full.
- **Morphs in Progress:** pick the ability and write the one aspect that changes. Log each attempt as a Success or a Failure; either one spends 2 XP. The tracker shows the next difficulty (6, easing by 1 per attempt), progress toward 3 successes, total XP spent, and the new cost (1.5x, rounded up).
- **Abilities that cost more than one pool:** an ability's window has three boxes, Might, Speed and Intellect. Enter the points it takes from each and leave unused pools at 0. On the character sheet the ability shows its full cost, for example "(1 Might, 1 Speed, 1 Intellect)". The pay button takes each pool's cost minus that pool's Edge and posts what was paid to chat. Abilities that cost only one pool still work exactly like the Cypher System's (All-in-One roll dialog included). Abilities set to cost XP or "Any Pool" keep the system's original fields.
- **Stacked actions:** to use several abilities in one action (for example Heavy Draw + Sneak Attack + Multiarrow), click the stack icon on each one in the Abilities tab. A tray at the top of the tab adds up their costs per pool, takes Edge off each pool's total once, and pays everything with one button. The payment is posted to chat and the stack is cleared. Paying a single ability on its own still takes Edge off that ability's cost. When you stack an ability that costs "Any Pool", the sheet asks which pool it should draw from. You can change that pool from the dropdown on its chip in the tray. Only abilities that cost XP are left out of a stack.
- **Paying with XP when a pool runs out:** if paying for an ability or a stack would take a pool below 0, the pool drops to 0 and the missing points are paid with XP. The sheet asks first, and the chat message says how much XP was used. If there isn't enough XP, nothing is paid. Two settings control this: turning it off, and how much XP one missing point costs (default 1). This covers the pay buttons on the sheet and the stack. It doesn't cover the Cypher System's All-in-One roll dialog or Effort spent in a roll.
- **Passive abilities:** tick **Passive ability** in an ability's window. Passives move into a folding "Passive abilities" section under the active ones, with a count, and have no pay or stack buttons. Each person's sheet remembers whether that section is open. The active ability headings show a count too.
- **No GM Notes tab.** The Cypher System's GM Notes tab is removed. Anything already in it stays saved on the actor.
- Pools (Might, Speed, Intellect, Edge) and the damage track are unchanged for now.

## Other details

- The dice tray on the side of the sheet has d4, d6, d8, d10, d12, d20 and d100. Rolls follow each person's roll mode (public, private, blind).
- Tier, XP and Armor sit in shields. Armor is calculated from equipped armor.
- A pool ring glows when the pool drops to a quarter or less.
- The Teen form of the Unmasked game mode falls back to the system's original header.
- Homebrew data is stored in actor flags under `awakened-dreaming-sheet`. Recovery rolls use the system's own recovery fields.

Fonts: Cinzel, Cinzel Decorative and EB Garamond, all under the SIL Open Font License. The license files are in `fonts/`.

## Publishing a new version (for the maintainer)

Raise `version` in `module.json` and push to `main`. GitHub Actions sees the new version, tags it (for example `v1.7.1`), builds `module.zip` and publishes a release with `module.json` and `module.zip` attached. Foundry's update button picks it up from there. A push that doesn't change the version doesn't publish anything.
