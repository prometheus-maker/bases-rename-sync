// Just enough of Obsidian's runtime API for an end-to-end test of main.ts. Classes live on globalThis so the copy
// bundled into main.ts and the copy the test imports are the same classes (instanceof works).
const g = globalThis;
g.__TAbstractFile ??= class TAbstractFile {};
g.__TFile ??= class TFile extends g.__TAbstractFile {
	constructor(path) { super(); this.path = path; }
	get name() { return this.path.split("/").pop(); }
	get basename() { return this.name.replace(/\.[^.]+$/, ""); }
	get extension() { return this.name.includes(".") ? this.name.split(".").pop() : ""; }
};
g.__TFolder ??= class TFolder extends g.__TAbstractFile {
	constructor(path, children = []) { super(); this.path = path; this.children = children; }
};
g.__notices ??= [];
export const TAbstractFile = g.__TAbstractFile, TFile = g.__TFile, TFolder = g.__TFolder, notices = g.__notices;
export class Notice { constructor(msg) { notices.push(msg); } }
export class Plugin {
	constructor(app) { this.app = app; }
	registerEvent() {}
}
