import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getGdmCloudflareEnv() {
  return getCloudflareContext().env;
}

export async function getGdmCloudflareEnvAsync() {
  return (await getCloudflareContext({ async: true })).env;
}
