# Microsoft Teams tenant-wide install

Use this for the YC demo tenant and, later, pilot tenants. The goal is not
per-user sideloading. An admin publishes the Grasp Teams app and pins/installs
it for the tenant with an app setup policy.

## 1. Create the Azure bot

1. Create an Azure Bot resource backed by an Entra app registration.
2. Enable the Microsoft Teams channel.
3. Set the bot messaging endpoint to:
  ```text
   https://<your-app-host>/api/teams/messages
  ```
   For local demo work, use a tunnel:
   Then set the endpoint to:
4. Copy the app id, client secret, and tenant id into `app/.env.local`:
  ```bash
   MicrosoftAppType="SingleTenant"
   MicrosoftAppId="<app-id>"
   MicrosoftAppPassword="<client-secret>"
   MicrosoftAppTenantId="<tenant-id>"
  ```

## 2. Build the Teams app package

Copy `teams-app-manifest.template.json` to `teams-app-manifest.json` and replace:

- `{{MICROSOFT_APP_ID}}` with the Azure bot app id.
- `{{APP_HOSTNAME}}` with the hostname that serves `/api/teams/messages`, without
`https://` and without a path.

Create two PNG icons in the same folder as the manifest:

- `color.png`: 192x192
- `outline.png`: 32x32, transparent outline icon

Zip exactly these files at the root of the zip:

```text
manifest.json
color.png
outline.png
```

## 3. Publish tenant-wide

In Teams Admin Center:

1. Go to **Teams apps > Manage apps**.
2. Upload the custom app package.
3. Allow the app for the tenant.
4. Go to **Teams apps > Setup policies**.
5. Add Grasp to **Installed apps**.
6. Optionally add Grasp to **Pinned apps** so it is visible in the rail.
7. Assign the policy globally or to the demo users.

Microsoft can take time to apply app setup policies. For the live YC demo,
verify the target user accounts the day before and again before the call.

## 4. Verify Grasp can message users

1. Open `/settings/teams`.
2. Confirm the page shows `Configured`.
3. Have a tenant user open Grasp in Teams or send it a message.
4. Confirm the user appears under captured conversations.
5. Send a test message from `/settings/teams`.
6. Activate a demo rollout and confirm at least one kickoff DM is delivered in
  Teams.

Tenant-wide install makes the bot available and starts install events, but
proactive 1:1 sends still depend on Grasp having a stored conversation
reference for the user. If a user does not appear under captured conversations,
ask them to open the Grasp app in Teams once or message the bot.