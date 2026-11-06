import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

await build({ entryPoints: ["src/main.ts"], bundle: true, format: "esm", outfile: "build/main-test.mjs", logLevel: "warning",
	alias: { obsidian: "./test/obsidian-mock.mjs" } });
const { default: Plugin } = await import("../build/main-test.mjs");
const { TFile, TFolder, notices } = await import("./obsidian-mock.mjs");

function fakeApp(files) {
	const store = new Map(Object.entries(files));
	const objs = new Map([...store.keys()].map((p) => [p, new TFile(p)]));
	let renameHandler, writes = 0;
	const vault = {
		getFiles: () => [...objs.values()],
		cachedRead: async (f) => store.get(f.path),
		process: async (f, fn) => { writes++; store.set(f.path, fn(store.get(f.path))); },
		on: (ev, h) => { renameHandler = h; },
	};
	const app = { vault, workspace: { onLayoutReady: (cb) => cb() } };
	return {
		app, store,
		get writes() { return writes; },
		async rename(oldPath, newPath) {
			const f = objs.get(oldPath); objs.delete(oldPath); store.set(newPath, store.get(oldPath)); store.delete(oldPath);
			f.path = newPath; objs.set(newPath, f);
			renameHandler(f, oldPath);
		},
	};
}

test("renaming a note updates .base files and ```base blocks, and nothing else", async () => {
	const v = fakeApp({
		"Projects/Apollo.md": "# Apollo",
		"Tasks.base": 'filters:\n  and:\n    - file.hasLink(link("Apollo"))\n',
		"Dashboard.md": 'Intro [[Apollo]]\n\n```base\nfilters:\n  - \'up == link("Projects/Apollo")\'\n```\n',
		"Other.base": 'filters:\n  - file.hasTag("x")\n',
		"Plain.md": "no bases here, link(\"Apollo\") in prose",
	});
	const p = new Plugin(v.app);
	await p.onload();
	await v.rename("Projects/Apollo.md", "Projects/Apollo 2027.md");
	await p.queue;
	assert.equal(v.store.get("Tasks.base"), 'filters:\n  and:\n    - file.hasLink(link("Apollo 2027"))\n');
	assert.ok(v.store.get("Dashboard.md").includes('link("Projects/Apollo 2027")'));
	assert.ok(v.store.get("Dashboard.md").startsWith("Intro [[Apollo]]"), "note links are Obsidian's job");
	assert.equal(v.store.get("Plain.md"), "no bases here, link(\"Apollo\") in prose");
	assert.equal(v.writes, 2, "only the two files that change are written");
	assert.match(notices.at(-1), /updated 2 references in (Tasks, Dashboard|Dashboard, Tasks)/);
});

test("a moved folder updates full paths of every note inside", async () => {
	const v = fakeApp({
		"Work/Apollo.md": "",
		"Work/Zeus.md": "",
		"All.base": 'filters:\n  or:\n    - \'up == link("Work/Apollo")\'\n    - \'"Work/Zeus.md" == file.path\'\n',
	});
	const p = new Plugin(v.app);
	await p.onload();
	// Obsidian moves the folder; files inside get new paths
	for (const [o, n] of [["Work/Apollo.md", "Archive/Apollo.md"], ["Work/Zeus.md", "Archive/Zeus.md"]]) {
		const f = v.app.vault.getFiles().find((x) => x.path === o);
		v.store.set(n, v.store.get(o)); v.store.delete(o); f.path = n;
	}
	const folder = new TFolder("Archive", v.app.vault.getFiles().filter((f) => f.path.startsWith("Archive/")));
	await p.onRename(folder, "Work");
	assert.equal(v.store.get("All.base"), 'filters:\n  or:\n    - \'up == link("Archive/Apollo")\'\n    - \'"Archive/Zeus.md" == file.path\'\n');
});
