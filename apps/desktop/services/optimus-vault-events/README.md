# Optimus BotVault event feed

This CT115 service is the authoritative live-change source for the desktop
BotVault pane. It scans `/mnt/vaults/BotVault` every 600 ms and broadcasts
Markdown note creates, modifications, and deletions over:

```text
ws://192.168.0.116:9128/events
```

The desktop derives the host from its configured Optimus voice-service URL and
reconnects automatically. Events refresh the BotVault tree and quietly reload
the currently open note. They do not change note focus.

## Wire contract

The server sends a ready envelope on connection:

```json
{"type":"ready","root":"/mnt/vaults/BotVault","timestamp":1784125685000}
```

Each filesystem change is one envelope:

```json
{
  "type": "note.changed",
  "kind": "created",
  "path": "/mnt/vaults/BotVault/Optimus/00-Inbox/brainstorm.md",
  "timestamp": 1784125685551
}
```

`kind` is `created`, `modified`, or `deleted`.

## Hermes navigation contract

The event feed makes content updates reliable, but explicit navigation remains
an agent UI action. Hermes should follow these rules:

1. For "open/show X in BotVault", resolve the note and call
   `optimus_cockpit_panel` with:

   ```json
   {"action":"open","panel":"botvault","path":"Optimus/path/to/X.md"}
   ```

2. For "create X and open it", write the Markdown file under
   `/mnt/vaults/BotVault` first. After the write succeeds, call the same panel
   tool with the created note's relative or absolute path.
3. While working on the currently open note, write normally. The watcher
   refreshes the visible content; repeated panel calls are unnecessary.
4. Do not claim a note is open unless the panel tool completed successfully.

## CT115 deployment

Files:

- `/opt/optimus-vault-events/server.py`
- `/opt/optimus-vault-events/smoke_test.py`
- `/etc/systemd/system/optimus-vault-events.service`

The deployed CT115 voice service also includes
`voice-service-botvault-resolver.patch`, allowing an exact one-word note such
as `SCHEMA.md` to be opened by name. Its pre-deploy backup is
`/opt/optimus-voice-service/voice_service.py.bak-2026-07-15-botvault-resolver`.

Operations:

```bash
systemctl status optimus-vault-events.service
journalctl -u optimus-vault-events.service -f
python3 /opt/optimus-vault-events/smoke_test.py
```
