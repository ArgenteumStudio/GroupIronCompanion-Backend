# Group Iron Companion Backend

The self-hosted server, web dashboard and Discord bot for
[Group Iron Companion](https://github.com/ArgenteumStudio/MayoClan).
This repository is for clan administrators hosting the service. Clan members
install the RuneLite plugin and use the server URL and individual character
token supplied by their administrator.

This is an independent project and is not affiliated with Jagex or RuneLite.

Created using intellectual property belonging to Jagex Limited under the terms
of Jagex's Fan Content Policy. This content is not endorsed by or affiliated
with Jagex.

The BSD 2-Clause license applies only to original project code. Jagex-owned
images and other third-party materials are not covered and remain subject to
their respective terms.

## Requirements

- Node.js 22 or newer, with npm.
- A Discord server and a bot with **Message Content Intent** and **Server Members
  Intent** enabled.
- An HTTPS front end for remote plugin connections.

## Setup

Clone this repository and run these commands from its root:

```powershell
npm ci
Copy-Item .env.example .env
Copy-Item members.example.json members.json
Copy-Item branding.example.json branding.json
```

1. Invite your Discord bot to the clan server and give it access to the private
   channel where commands and alerts will be sent.
2. Put the owner's Discord user ID in `members.json`. The owner needs
   **Manage Server** permission.
3. Set `DISCORD_TOKEN`, `DISCORD_GUILD_ID` and `DISCORD_CHANNEL_ID` in `.env`.
   Optional per-alert channels and a separate stats channel are documented in
   [.env.example](.env.example).
4. Start the service:

   ```powershell
   npm start
   ```

5. In the configured Discord channel, the owner runs `!verify` and receives a
   private owner key by DM. Enter it on the web panel, then use **Manage group**
   to create a separate character token for each player.
6. Give each player the server URL, dashboard link and their own character token.
   They should follow the plugin's end-user instructions and enable only the
   sharing options they want.

Use the web panel to manage members, permissions, website colors, branding and
Discord message styles. The bot posts enabled game alerts to the configured
Discord channels; authorized users can use `!stats <player>` for synced stats.

## Hosting and private data

Local use defaults to `http://localhost:4000`. The listener is HTTP, not HTTPS,
and binds to `127.0.0.1` by default. For remote access, provide TLS through your
hosting platform or another HTTPS front end and keep the backend listener
private. For a proxy on another machine or container, choose an appropriate
`HOST` and firewall `PORT` so only the proxy can reach it.

Keep `.env`, `members.json`, `skill-emojis.json`, `branding.json`, `branding/`
and `data/` private. Never commit bot credentials, owner keys, character tokens
or real clan data. Share each character token only with its intended player,
and never share the owner key.

Disabling plugin sharing does not delete data already stored on your server.
Administrators are responsible for managing stored group data and access.

## Tests and fictional preview

Run the backend tests from this repository's root:

```powershell
npm test
```

To preview the dashboard with fictional data:

```powershell
npm run preview
```

Open `http://127.0.0.1:4173`. The preview does not use real group data or send
Discord notifications.

## Moving an existing installation

The backend files previously lived in the plugin repository's `backend/`
directory. They now live at this repository's root, with the same internal
paths and unchanged application code.

Back up your private configuration and `data/` before migrating. Transfer them
privately to this checkout, preserve any custom paths in `.env`, and update
your service's working directory to this repository's root. Do not add a
`backend/` prefix to the commands above.

Plugin development and local builds remain documented in the plugin
repository's [CONTRIBUTING.md](https://github.com/ArgenteumStudio/MayoClan/blob/main/CONTRIBUTING.md).
