# Run systems

Combat still comprises two levels of five rooms each, with the boss in room 5.
Draft, vending and sacrifice rooms are extra stops and do not replace encounters.
There is no permanent power progression or currency bank between runs.

## Physical kit draft

Solo starts with three random weapon pickups. Co-op starts with player count + 2.
Eight curated kits combine a weapon with one attached upgrade and occasional
health/shield tradeoffs. Walk within 80 pixels and press E (or the nearby Grab
button). The first successful claim owns that pickup. Each player claims one;
all remaining options disappear immediately when everyone has picked. Combat
then begins. If someone disconnects, the remaining players can finish the draft.

| Kit | Weapon | Attached upgrade / tradeoff |
| --- | --- | --- |
| Fractured Vanguard | Longsword | Keen Edge; 55 starting shield |
| Perfect Initiate | Dagger | Perfection |
| Wide Sentinel | Longsword | Wide Wake |
| Patient Duelist | Sword | Lingering Steel |
| Fleet Scout | Dagger | Windrunner; 85 maximum HP |
| Ironbark Guard | Sword | Barkskin |
| Hungry Knight | Longsword | Vampire; 80 maximum HP |
| Spark Runner | Dagger | Spark Step |

## Trait combinations

New passives: Lingering Steel, Wide Wake, Returning Force, Spark Step,
Opportunist and Green Spark. They change melee-parry stun duration, swing/effect
coverage, reflected damage, dash pulses, stunned-target damage and parry healing.

| Exclusive upgrade | Prerequisites | Effect |
| --- | --- | --- |
| Stun Nova | Lingering Steel + Wide Wake | Perfect parry stuns nearby enemies; boss stun capped at 0.4s |
| Thunder Step | Spark Step + Wide Wake | Dash pulse deals double damage and briefly stuns |
| Living Mirrors | Returning Force + Green Spark | Perfect parry fires three friendly shards |

When prerequisites are met, each subsequent room reward has a 65% chance to
feature one eligible combination among its three choices. This is increased
chance, not a guarantee. Owned combinations do not reappear. Relics and
unqualified combinations never appear in ordinary random reward slots.

## Shared Scrap and vending

Normal enemy deaths credit 8 Scrap; each boss credits 70. Suicide detonations
also award Scrap. Rewards are credited once, regardless of who gets the kill.
Individual co-op deaths do not remove Scrap; a party wipe ends the run and clears
it. A new run begins with zero. No currency persists between runs.

After normal rewards, physical exits open in the cleared room. The left sword
door continues to combat; the right blood-drop door offers a sacrifice altar.
A coin door in the bottom wall has a 35% chance to offer a vending room. Before
each boss, the coin door is the only exit, guaranteeing a vending stop. Walk
outward through an opening to enter; co-op route selection belongs to the host.
The floor and unrelated cover remain in place, while each exit corridor is cleared.
Downed allies revive at half health for this peaceful routing step; they receive
no additional transition heal.

The vending machine ejects six physical items in a staggered arc. They land in a
semicircle with permanent price tags: red if shared Scrap is insufficient, green
when affordable. Walk near one for its description, then into it to purchase.
Items cannot be collected during their flight. Remaining stock is shown on
multi-copy items; step off and return for another copy. Purchases affect the buyer.

Shield repairs cost 45 (two in stock); 35%-HP tonics cost 25 (two); two random
ordinary upgrades cost 35 each (one copy each); two random relics cost 90 each
(one copy each). Inapplicable or unaffordable purchases leave stock and funds
untouched. Competing co-op contacts are resolved on the authoritative room server
so the same last item cannot be sold twice. The machine shakes and flashes as it
dispenses, items bounce on landing, and bought items fly toward the player.

The host walks through the right-hand combat exit to continue, without pressing
E. Normal small room healing occurs once at that transition; shields do not
otherwise refill at stops. Shops have no vending modal and keep combat controls
active. Sacrifice altars retain their interaction and confirmation panel.

## Sacrifice altars

Walk to the altar and press E. Each living player may independently choose one of
three random relics, or leave without a sacrifice. Accepting loses 25% of current
maximum health, rounded up, and permanently multiplies future maximum-health
gains by 0.75 for that run. Multiple altar sacrifices compound. Current HP is
clamped to the reduced maximum; the altar does not provide a heal. The modifier
survives revival and level transitions. Level-clear healing fills only the
reduced maximum. Players below 20 maximum HP cannot sacrifice. One sacrifice
per player per altar; owning a relic already prevents selecting it again.

Relics: Echo Blade (every third melee strike releases a damage pulse), Mirror
Engine (perfect-parry shards), Storm Heart (damaging/stunning dash pulse),
Bloodroot (kill healing and armor), Overdrive Core (melee and reflected damage).
All effects respect Suicide Bomber immunity. Damage pulses respect cover and
front-facing Riot Shields; boss stun effects have a shorter cap.

## Implementation and multiplayer

The engine stores all run state in the game snapshot. Room actions enforce host
routing, proximity, eligibility, shared stock and funds. Draft and stop movement
runs on the same simulation as combat. Cloudflare snapshots include kit claims,
Scrap, stock, route choices, altar usage and health penalties. Kit claims and
purchases use the authenticated authoritative room path. Existing entity and VFX
pools are retained; new combat pulses use pooled events, particles and projectiles.

The first version's numbers are initial balance values; deterministic engine
and HTTP/Cloudflare tests cover the full loop, concurrency and modifier rules.
