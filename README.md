# ClickUp CLI

Small local CLI for reading and updating ClickUp tasks with a personal API token.

## Token setup

Store your token outside the repo:

```bash
mkdir -p ~/.clickup
chmod 700 ~/.clickup
printf '%s\n' 'YOUR_CLICKUP_TOKEN' > ~/.clickup/token
chmod 600 ~/.clickup/token
```

The CLI also checks:

- `~/.clickup/token.txt`
- `~/.clickup/config.json`
- `CLICKUP_API_TOKEN`

## Examples

```bash
npm run clickup:me
npm run clickup:teams
node clickup.js spaces --team <teamId>
node clickup.js task --id <taskId>
node clickup.js comments --id <taskId>
node clickup.js comment --id <taskId> --text "Done"
node clickup.js update-task --id <taskId> --status Closed
node clickup.js attach --id <taskId> --file /tmp/screenshot.png
```

## Notes

- Attachments use the ClickUp multipart field `attachment`.
- Cloud-hosted files may fail upload; copying them to a local path like `/tmp` first is more reliable.
