import { Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { Rename, rewrite, rewriteMarkdown } from "./rewrite";

const BASE_BLOCK = /^[ \t]*(```+|~~~+)[ \t]*base[ \t]*$/m;

export default class BasesRenameSync extends Plugin {
	private queue: Promise<void> = Promise.resolve();

	async onload() {
		this.app.workspace.onLayoutReady(() => {
			// registered after the vault has loaded, so startup indexing isn't mistaken for renames
			this.registerEvent(
				this.app.vault.on("rename", (file, oldPath) => {
					// one rename at a time: a folder move fires many, and each must see the previous one's result
					this.queue = this.queue.then(() => this.onRename(file, oldPath)).catch((e) => console.error("Bases rename sync:", e));
				}),
			);
		});
	}

	private renamesFor(file: TAbstractFile, oldPath: string): Rename[] {
		if (file instanceof TFile) return [this.rename(oldPath, file.path, file)];
		if (file instanceof TFolder) {
			// a moved folder: every file inside it has a new path
			const out: Rename[] = [];
			const walk = (f: TAbstractFile) => {
				if (f instanceof TFile) out.push(this.rename(oldPath + f.path.slice(file.path.length), f.path, f));
				else if (f instanceof TFolder) f.children.forEach(walk);
			};
			walk(file);
			return out;
		}
		return [];
	}

	private rename(oldPath: string, newPath: string, file: TFile): Rename {
		const oldName = oldPath.split("/").pop() ?? oldPath;
		const others = this.app.vault.getFiles().some((f) => f !== file && f.name === oldName);
		return { oldPath, newPath, basenameUnique: !others };
	}

	private async onRename(file: TAbstractFile, oldPath: string): Promise<void> {
		const renames = this.renamesFor(file, oldPath);
		if (!renames.length) return;
		let refs = 0;
		let skipped = 0;
		const changed: string[] = [];
		for (const target of this.app.vault.getFiles()) {
			const isBase = target.extension === "base";
			if (!isBase && target.extension !== "md") continue;
			const before = await this.app.vault.cachedRead(target);
			if (!isBase && !BASE_BLOCK.test(before)) continue;
			const apply = (text: string) => {
				let n = 0;
				let s = 0;
				for (const r of renames) {
					const res = isBase ? rewrite(text, r) : rewriteMarkdown(text, r);
					text = res.text;
					n += res.count;
					s += res.skipped;
				}
				return { text, n, s };
			};
			const dry = apply(before);
			skipped += dry.s;
			if (!dry.n) continue; // don't touch files that don't change
			let n = 0;
			await this.app.vault.process(target, (text) => {
				const res = apply(text); // on the current text, in case it changed since the read
				n = res.n;
				return res.text;
			});
			if (n) {
				refs += n;
				changed.push(target.basename);
			}
		}
		if (refs) {
			const list = changed.slice(0, 3).join(", ") + (changed.length > 3 ? ` and ${changed.length - 3} more` : "");
			new Notice(`Bases rename sync: updated ${refs} reference${refs > 1 ? "s" : ""} in ${list}.`);
		}
		if (skipped) {
			new Notice(
				`Bases rename sync: left ${skipped} reference${skipped > 1 ? "s" : ""} by bare name unchanged, ` +
					`because another file is also called "${oldPath.split("/").pop()}". Use full paths in base filters to avoid this.`,
				10000,
			);
		}
	}
}
