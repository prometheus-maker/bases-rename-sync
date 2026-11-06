// Pure rewrite logic, no Obsidian imports: unit-tested in test/rewrite.test.mjs.
//
// When a note moves from oldPath to newPath, Obsidian updates [[links]] in notes and properties, but not the
// expressions inside Bases (.base files and ```base blocks): filters and formulas keep pointing at the old name and
// the base silently comes back empty. This finds the references in that text and rewrites them.

export interface Rename {
	oldPath: string; // "Projects/Old note.md"
	newPath: string; // "Archive/New note.md"
	/** false when another file still has the old file's basename: a bare "Old note" may mean that one */
	basenameUnique: boolean;
}

export interface Result {
	text: string;
	count: number;
	/** bare-name references left alone because the old name is ambiguous */
	skipped: number;
}

const stripMd = (p: string) => p.replace(/\.md$/i, "");
const baseName = (p: string) => stripMd(p.split("/").pop() ?? p);
const fileName = (p: string) => p.split("/").pop() ?? p;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Map an old link target (as written) to the new one, keeping its form:
 * full path with .md, full path without .md, or bare basename. Returns null if it isn't this file.
 */
function retarget(target: string, r: Rename): string | null | "ambiguous" {
	const t = target.trim();
	if (t === r.oldPath) return r.newPath;
	if (t === stripMd(r.oldPath)) return stripMd(r.newPath);
	if (t === baseName(r.oldPath) || t === fileName(r.oldPath)) {
		const n = t.endsWith(".md") ? fileName(r.newPath) : baseName(r.newPath);
		if (n === t) return null; // only the folder changed: a bare name still resolves
		return r.basenameUnique ? n : "ambiguous";
	}
	return null;
}

/** Rewrite every reference to the renamed note in the text of a .base file or a ```base block. */
export function rewrite(text: string, r: Rename): Result {
	let count = 0;
	let skipped = 0;
	const swap = (target: string): string | null => {
		const n = retarget(target, r);
		if (n === "ambiguous") {
			skipped++;
			return null;
		}
		if (n === null || n === target.trim()) return null; // moved without renaming: a bare name still resolves
		count++;
		return n;
	};

	// 1. link("Target") / link('Target', "display")
	text = text.replace(/\blink\(\s*(["'])((?:(?!\1).)+)\1/g, (m, q: string, target: string) => {
		const [path, ...rest] = target.split(/(?=[#|])/); // keep #heading or |alias
		const n = swap(path);
		return n === null ? m : `link(${q}${n}${rest.join("")}${q}`;
	});

	// 2. wikilinks written inside strings: "[[Target]]", "[[Target|alias]]", "[[Target#Heading]]"
	text = text.replace(/\[\[([^\]|#^]+)([#^|][^\]]*)?\]\]/g, (m, target: string, tail?: string) => {
		const n = swap(target);
		return n === null ? m : `[[${n}${tail ?? ""}]]`;
	});

	// 3. comparisons with the file's own name: file.name == "Old.md", file.basename != 'Old', "x/Old.md" == file.path
	const attr = { name: fileName, basename: baseName, path: (p: string) => p } as const;
	for (const [key, f] of Object.entries(attr)) {
		if (f(r.oldPath) === f(r.newPath)) continue; // e.g. moved to another folder: the basename still matches
		const oldV = esc(f(r.oldPath));
		const left = new RegExp(`(\\bfile\\.${key}\\s*[!=]=\\s*)(["'])${oldV}\\2`, "g");
		const right = new RegExp(`(["'])${oldV}\\1(\\s*[!=]=\\s*file\\.${key}\\b)`, "g");
		const isBare = key !== "path";
		const ok = () => {
			if (isBare && !r.basenameUnique) {
				skipped++;
				return false;
			}
			count++;
			return true;
		};
		text = text.replace(left, (m, pre: string, q: string) => (ok() ? `${pre}${q}${f(r.newPath)}${q}` : m));
		text = text.replace(right, (m, q: string, post: string) => (ok() ? `${q}${f(r.newPath)}${q}${post}` : m));
	}
	return { text, count, skipped };
}

/** Rewrite only inside ```base code blocks of a Markdown note. */
export function rewriteMarkdown(md: string, r: Rename): Result {
	let count = 0;
	let skipped = 0;
	const text = md.replace(/^([ \t]*)(```+|~~~+)[ \t]*base[ \t]*\n([\s\S]*?)^\1\2[ \t]*$/gm, (m, ind: string, fence: string, body: string) => {
		const res = rewrite(body, r);
		count += res.count;
		skipped += res.skipped;
		return res.count ? m.replace(body, res.text) : m;
	});
	return { text, count, skipped };
}
