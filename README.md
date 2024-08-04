# ImprovedMobs Difficulty is Game Stage (written in KubeJS)

Hi! This is my first ever coding project in Minecraft. This is intended for the Cursed Walking modpack and is intended to be a replacement for the "difficulty over time" mechanic.

## How do I use it?

In order to use this properly, you probably need to update `improvedmobs/common.toml`. To do this, find the `"Difficulty type"` line and ensure it reads `"Difficulty type" = "PLAYERMEAN"`.

For now, all you really need to install this is to install KubeJS/Rhino on your server/client for Cursed Walking and then copy the server_script `game_stage_tracking.js` into the `server_scripts` folder in your server (multiplayer)/client (singleplayer) `kubejs` folder.

## Contributing

If you wanna contribute, you should use VSCode and have the ESLint extension installed.
