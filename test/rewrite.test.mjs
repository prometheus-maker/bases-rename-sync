import assert from "node:assert/strict";
import { test } from "node:test";
import { rewrite, rewriteMarkdown } from "../build/rewrite.mjs";

const r = { oldPath: "Projects/Apollo.md", newPath: "Projects/Apollo 2027.md", basenameUnique: true };

// A base like the Notion importer and the forum report (forum.obsidian.md/t/108976) produce.
const base = `filters:
  and:
    - file.hasLink(link("Apollo"))
    - 'project == link("Projects/Apollo")'
    - parent.contains("[[Apollo]]")
    - file.inFolder("Projects")
formulas:
  is_main: 'file.basename == "Apollo"'
  same: '"Projects/Apollo.md" == file.path'
  other: 'link("Apollonia")'
views:
  - type: table
    name: "Apollo tasks"
    filters:
      and:
        - 'up == link("Apollo#Goals", "goals")'
        - 'note == "[[Apollo|the project]]"'
`;

test("rewrites links, wikilinks and name comparisons, keeping each one's form", () => {
	const res = rewrite(base, r);
	assert.equal(res.count, 7);
	assert.equal(res.skipped, 0);
	for (const want of ['file.hasLink(link("Apollo 2027"))', 'link("Projects/Apollo 2027")', '"[[Apollo 2027]]"',
		'file.basename == "Apollo 2027"', '"Projects/Apollo 2027.md" == file.path', 'link("Apollo 2027#Goals", "goals")',
		'"[[Apollo 2027|the project]]"']) assert.ok(res.text.includes(want), want);
});

test("leaves look-alikes alone: other notes, folders, view names", () => {
	const res = rewrite(base, r);
	assert.ok(res.text.includes('link("Apollonia")'));
	assert.ok(res.text.includes('file.inFolder("Projects")'));
	assert.ok(res.text.includes('name: "Apollo tasks"'));
});

test("a bare name is not touched when another note has the old name", () => {
	const res = rewrite(base, { ...r, basenameUnique: false });
	assert.ok(res.text.includes('file.hasLink(link("Apollo"))'));
	assert.ok(res.text.includes('link("Projects/Apollo 2027")'), "full paths are unambiguous");
	assert.ok(res.text.includes('"Projects/Apollo 2027.md" == file.path'));
	assert.equal(res.skipped, 5);
});

test("moving to another folder: full paths change, bare names don't need to", () => {
	const res = rewrite(base, { oldPath: "Projects/Apollo.md", newPath: "Archive/Apollo.md", basenameUnique: false });
	assert.ok(res.text.includes('link("Archive/Apollo")'));
	assert.ok(res.text.includes('"Archive/Apollo.md" == file.path'));
	assert.ok(res.text.includes('file.hasLink(link("Apollo"))'));
	assert.equal(res.skipped, 0, "nothing ambiguous: bare names didn't change");
	assert.equal(res.count, 2);
});

test("file.name compares with the .md name; single quotes are kept", () => {
	const res = rewrite("filters: \"file.name != 'Apollo.md'\"", r);
	assert.equal(res.text, "filters: \"file.name != 'Apollo 2027.md'\"");
});

test("only ```base blocks of a note change", () => {
	const md = "See [[Apollo]] here.\n\n```base\nfilters:\n  - file.hasLink(link(\"Apollo\"))\n```\n\n```js\nlink(\"Apollo\")\n```\n";
	const res = rewriteMarkdown(md, r);
	assert.equal(res.count, 1);
	assert.ok(res.text.startsWith("See [[Apollo]] here."), "note text is Obsidian's job");
	assert.ok(res.text.includes('```base\nfilters:\n  - file.hasLink(link("Apollo 2027"))\n```'));
	assert.ok(res.text.includes('```js\nlink("Apollo")\n```'));
});

test("nothing to do returns the text unchanged", () => {
	const t = "filters:\n  - file.hasTag(\"x\")\n";
	assert.deepEqual(rewrite(t, r), { text: t, count: 0, skipped: 0 });
});
