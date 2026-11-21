import { fireEvent, screen, within } from "@testing-library/react";

/** Bestätigungsdialog abwarten und mit dem Knopf `action` bestätigen. */
export async function confirmDialog(action: string): Promise<void> {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: action }));
}

/** Bestätigungsdialog abwarten und abbrechen. */
export async function cancelDialog(): Promise<void> {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
}
