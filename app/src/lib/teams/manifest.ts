export interface TeamsManifestInput {
  microsoftAppId: string;
  teamsAppManifestId: string | null;
  appHostname: string;
}

export function buildTeamsManifest(input: TeamsManifestInput) {
  const appId = input.microsoftAppId.trim();
  const manifestId = input.teamsAppManifestId?.trim() || appId;
  const hostname = input.appHostname.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  return {
    $schema:
      "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: "0.1.1",
    id: manifestId,
    developer: {
      name: "Grasp",
      websiteUrl: "https://withgrasp.com",
      privacyUrl: "https://withgrasp.com/privacy",
      termsOfUseUrl: "https://withgrasp.com/terms",
    },
    name: {
      short: "Grasp",
      full: "Grasp Change Management Agent",
    },
    description: {
      short: "Grasp helps teams plan and land workplace changes.",
      full: "Grasp helps leadership teams plan internal changes, check in with affected employees, surface concerns, and close the loop inside Microsoft Teams.",
    },
    icons: {
      outline: "outline.png",
      color: "color.png",
    },
    accentColor: "#2E7D32",
    bots: [
      {
        botId: appId,
        scopes: ["personal"],
        supportsFiles: false,
        isNotificationOnly: false,
      },
    ],
    webApplicationInfo: {
      id: appId,
      resource: `api://${hostname}/${appId}`,
    },
    permissions: ["identity", "messageTeamMembers"],
    validDomains: [hostname],
  };
}
