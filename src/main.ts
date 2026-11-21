import { Plugin } from "obsidian";

export default class KyleTicketsPlugin extends Plugin {
  override async onload(): Promise<void> {
    console.log("kyle-tickets loaded");
  }

  override onunload(): void {}
}
