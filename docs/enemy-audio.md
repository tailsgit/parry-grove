# Enemy weapon sounds

Every enemy and boss has a distinct weapon voice. Launcher, melee, beam, mine and electronic attacks have different timbres. Mines, grenades, ricochets and the Warden shockwave also have matching secondary cues.

Sound samples are deterministic and prepared once when audio unlocks. Voices use positional stereo and distance falloff; a shared limiter and a 16-voice cap keep crowds controlled. Esc → Sound mutes the entire mix immediately. Audio does not consume combat randomness.

Attack events carry the weapon identity and action through Cloudflare snapshots, so clients play the correct sound even when the firing enemy has already disappeared.

The downloadable preview follows this order:

| Start | Enemy type | Sound |
| --- | --- | --- |
| 0.00s | bow | Bowstring twang |
| 0.40s | pistol | Dry pistol crack |
| 0.71s | homing | Seeker launch whirr |
| 1.21s | shotgun | Shotgun boom and pump |
| 1.69s | mortar | Mortar tube thump |
| 2.15s | brawler | Heavy gauntlet swing |
| 2.50s | lancer | Spear thrust and ring |
| 2.88s | railgun | Rail beam snap and hum |
| 4.06s | miner | Mine latch and arming click |
| 4.45s | ricochet | Metallic ricochet gun crack |
| 4.83s | suicide | Bomber fuse ticks |
| 5.36s | cluster | Grenade launcher thunk and rattle |
| 5.79s | magnet | Conductor dart zap |
| 6.15s | sine | Undulating sine gun pulse |
| 6.62s | riot | Shield scrape and bash |
| 7.08s | boomerang | Boomerang air whip |
| 7.64s | twinBomber | Heavy boss grenade launcher |
| 8.18s | twinRicochet | Boss ricochet double crack |
| 8.65s | boss | Brass Warden cannon report |
