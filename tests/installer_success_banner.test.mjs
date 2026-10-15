import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const unixSource = readFileSync(new URL('../updater/install.sh', import.meta.url), 'utf8');
const windowsSource = readFileSync(new URL('../updater/install.ps1', import.meta.url), 'utf8');
const section = (source, startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(start >= 0 && end > start, `missing production section: ${startMarker}`);
	return source.slice(start, end);
};
const unixFunction = section(unixSource, 'print_success() {', '\nprint_footer() {');
const windowsFunction = section(windowsSource, 'function Write-Success {', '\nfunction Write-Footer {');
const bannerLines = output => output.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)
	.filter(line => /^    [|+]/.test(line));
const assertAligned = lines => {
	assert.equal(lines.length, 7, 'banner retains its frame, spacing and two messages');
	assert.match(lines[0], /^    \+-{50}\+$/);
	assert.equal(lines.at(-1), lines[0]);
	for (const line of lines) {
		assert.equal(line.length, lines[0].length, `misaligned banner row: ${JSON.stringify(line)}`);
	}
};

const hasBash = spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;
for (const [isUpdate, action] of [[false, 'installed'], [true, 'updated']]) {
	test(`Unix ${action} success banner aligns every printed row`, { skip: !hasBash && 'Bash is not available' }, () => {
		// Run only the production presentation function, never the installer entry point.
		const result = spawnSync('bash', ['-c', `${unixFunction}\nprint_success test "$1"`, 'banner-test', String(isUpdate)], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		const lines = bannerLines(result.stdout);
		assertAligned(lines);
		assert.ok(lines[2].includes(`ivLyrics has been ${action} successfully!`));
		assert.ok(lines[4].includes('Please restart Spotify to use ivLyrics.'));
	});
}

test('Windows literal banner rows, including the Spotify-open instruction, match the frame', () => {
	const template = windowsFunction.match(/\$box = @"\r?\n([\s\S]*?)\r?\n"@/);
	assert.ok(template, 'production Windows banner template must exist');
	const lines = bannerLines(template[1]).filter(line => !line.includes('$'));
	const frame = lines[0];
	assert.match(frame, /^    \+-{50}\+$/);
	assert.ok(lines.some(line => line.includes('Spotify will now open with ivLyrics.')),
		'the reported instruction is included in the width check');
	for (const line of lines) {
		assert.equal(line.length, frame.length, `misaligned Windows row: ${JSON.stringify(line)}`);
	}
});

test('Windows pads the variable-length success message to the banner interior width', () => {
	const frame = windowsFunction.match(/^    \+(-+)\+\r?$/m);
	assert.ok(frame);
	assert.match(windowsFunction, new RegExp(`\\$successMessage = \\("     ivLyrics has been \\$action successfully!"\\)\\.PadRight\\(${frame[1].length}\\)`));
	assert.match(windowsFunction, /^    \|\$successMessage\|\r?$/m);
});

const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const hasPowerShell = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore' }).status === 0;
for (const [isUpdate, action] of [[false, 'installed'], [true, 'updated']]) {
	test(`PowerShell ${action} success banner aligns every printed row`, { skip: !hasPowerShell && 'PowerShell is not available' }, () => {
		const script = `function Write-Colored { param([string]$Text, $Color) [Console]::WriteLine($Text) }\n${windowsFunction}\nWrite-Success -Version test -IsUpdate $${isUpdate}`;
		const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		const lines = bannerLines(result.stdout);
		assertAligned(lines);
		assert.ok(lines[2].includes(`ivLyrics has been ${action} successfully!`));
		assert.ok(lines[4].includes('Spotify will now open with ivLyrics.'));
	});
}
