import { password } from "@inquirer/prompts";

export async function promptForRecoveryPhrase(): Promise<string> {
  return password({
    message: "Recovery phrase",
  });
}
