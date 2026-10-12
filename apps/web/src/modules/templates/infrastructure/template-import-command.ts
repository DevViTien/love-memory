export type TemplateImportCommand = Readonly<{
  folder: string;
  operator: string;
  publish: boolean;
}>;

const USAGE =
  "Usage: pnpm template:import <folder> --operator <name> [--publish] (the operator is recorded in the audit log)";

/** Parses `<folder> --operator <name> [--publish]`; the folder and the operator are required. */
export function parseTemplateImportCommand(argv: readonly string[]): TemplateImportCommand {
  let folder: string | undefined;
  let operator: string | undefined;
  let publish = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--publish") {
      publish = true;
    } else if (argument === "--operator") {
      operator = argv[index + 1]?.trim();
      index += 1;
    } else if (argument?.startsWith("--operator=")) {
      operator = argument.slice("--operator=".length).trim();
    } else if (folder === undefined && argument && !argument.startsWith("--")) {
      folder = argument;
    } else {
      throw new Error(USAGE);
    }
  }
  if (!folder) throw new Error(USAGE);
  if (!operator || operator.startsWith("--") || operator.length > 200) {
    throw new Error(`Missing operator name. ${USAGE}`);
  }
  return { folder, operator, publish };
}
